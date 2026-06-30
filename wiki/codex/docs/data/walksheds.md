# Walksheds + walking distances (Mapbox)

Two committed Mapbox dumps power both the isochrone bands on the map and the "Stations within a 15 min walk" section of every POI popup.

## The two dumps

### 1. Walkshed polygons

`data/pois/raw/walksheds.json.gz` — one Mapbox Isochrone call per station (38 stations × `contours_minutes=5,10,15`), built by:

```bash
python3 data/pois/fetch_walksheds.py --refresh
```

Keyed by `f"{lines}-{stopCode}"` so the two stations sharing stop code 54 (Stadium / Judkins Park) stay distinct. The dump includes a `version` (a sha1) that downstream caches use to invalidate.

You only need to refresh this when station coordinates change.

### 2. Walking distances

`data/pois/raw/walking-distances.json.gz` — for every (station, POI) pair where the POI falls inside the station's 15-minute isochrone, the walking distance and duration from the Mapbox Matrix API, built by:

```bash
python3 data/pois/fetch_walking_distances.py --refresh
```

It caches per pair, so re-running is incremental — it only fetches Matrix entries for pairs it has not seen. Re-running against a new walkshed version invalidates the whole cache ([INV-009](../invariants.md)).

## How they attach to POIs

The POI build (`fetch_pois.py` default, or `build_refined.py`) reads both dumps and attaches a sorted array to each POI feature inside a walkshed:

```json
"stations": [
  {
    "stopCode": 50,
    "lines": "1,2",
    "name": "Westlake",
    "walkingMeters": 420,
    "walkingSeconds": 312,
    "band": 10
  }
]
```

POIs outside every 15-minute walkshed simply lack the array. If the dumps do not exist, the build runs without the array and prints a hint to refresh.

## The contracts

| Invariant | Guarantee |
| --- | --- |
| [INV-001](../invariants.md) | Membership implies a non-empty list — if Matrix can't route, fall back to a straight-line estimate rather than dropping the POI. |
| [INV-005](../invariants.md) | Each `stations[]` entry has `stopCode`, `lines`, `name`, `walkingMeters`, `walkingSeconds`, `band`. |
| [INV-007](../invariants.md) | `stations[]` is sorted ascending by `walkingSeconds`. |
| [INV-010](../invariants.md) | A POI's `stations[]` (stopCode, band) set equals its walkshed membership by point-in-polygon — no spurious or missing stations, correct band. |
| [INV-011](../invariants.md) | Every entry has finite, non-negative meters/seconds and a `band` in `{5, 10, 15}`. |

## Mapbox token for refresh

Set `MAPBOX_TOKEN` (or `MAPBOX_ACCESS_TOKEN`) in the environment. Public (`pk.`) and secret (`sk.`) tokens have identical capability for Isochrone and Matrix — both are read endpoints. The practical catch is URL restrictions: if the browser token `VITE_MAPBOX_ACCESS_TOKEN` is restricted to `walksheds.xyz`, calls from a Python script fail the referrer check. Either add the build host's URL (or leave it unrestricted) on that token, or mint a separate build-only token.
