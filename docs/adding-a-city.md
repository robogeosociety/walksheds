# Adding a city

Walksheds covers one rail system per **city**. A city is a row in the registry
(`data/cities.py`) plus an ingest module (`data/processors/<slug>.py`); nothing
else in the codebase names a city. This guide is the checklist.

## The model

`data/cities.py` is the single source of truth. It describes each city's map
framing, its lines, its default station, and — importantly — its
**capabilities**: which datasets that city actually has.

| Capability  | Artifact                                            | Needs                    |
| ----------- | --------------------------------------------------- | ------------------------ |
| `walksheds` | `data/cities/<slug>/raw/pois/walksheds.json.gz`      | `MAPBOX_TOKEN` (Isochrone) |
| `pois`      | `public/cities/<slug>/pois/tiles/`                   | `walksheds`, Overpass, Overture, `MAPBOX_TOKEN` (Matrix) |
| `exits`     | `public/cities/<slug>/station-exits.geojson`         | Overpass                 |

The frontend hides the chrome for any capability a city lacks, so a city can
ship rail-only and gain walksheds later without the UI promising data that
isn't there. **INV-025** checks the declared set against what is committed in
both directions: a city that declares `pois` without tiles fails, and so does a
city with tiles it forgot to declare.

`pois` requires `walksheds`, because POI-to-station membership *is* the
isochrone — a POI is "in" a walkshed by point-in-polygon against it.

## Layout a city owns

```
data/cities/<slug>/raw/            raw upstream feeds (committed)
data/cities/<slug>/raw/pois/       OSM / Mapbox dumps (committed, gzipped)
data/cities/<slug>/station-index.json
public/cities/<slug>/              everything the browser fetches
```

Shared code lives where it always did (`data/*.py`, `data/pois/*.py`); only
*data* is namespaced.

## Checklist

1. **Find an authoritative station feed.** It must give, per station, a stable
   identifier that orders stations along the line. Both existing cities have
   one: Sound Transit's three-digit codes increase away from Westlake=50, and
   HART's station IDs run 1..21 west to east. `src/routeGraph.js` derives line
   order by sorting on `stopCode`, so this is load-bearing — without a
   meaningful ordinal, navigation would need a hardcoded order.

2. **Add the `City(...)`** to `CITIES` in `data/cities.py`. Start with
   `capabilities=frozenset({})` and add them as the data lands.

3. **Write `data/processors/<slug>.py`** exposing:

   ```python
   def build(city) -> (stations_geojson, {line_id: alignment_featurecollection})
   ```

   `data/process.py` handles everything downstream — writing outputs, the
   station index, the sprite sheets. Station features must carry `name`,
   `line`, `lines`, `stopCode`, `shared`, and optionally `altName` (a place
   descriptor riders navigate by; station search matches it).

4. **Add the feed URLs and validators** to `FEEDS` in `data/refresh.py`. The
   validators are agency-specific on purpose — they exist to fail loudly on an
   upstream schema change rather than silently producing empty output.

5. **Fetch and process:**

   ```bash
   uv run data/refresh.py --city <slug>      # download + process + sprites
   python3 data/cities.py                    # regenerate src/cityRegistry.json
   ```

6. **Station exits** (optional, no token needed):

   ```bash
   python3 data/pois/fetch_station_exits.py --city <slug> --refresh
   ```

   Then add `CAP_EXITS` to the city's capabilities.

7. **Walksheds and POIs** (needs `MAPBOX_TOKEN`; the Matrix step costs real
   API calls — one per (station, POI) pair inside a 15-minute isochrone):

   ```bash
   export MAPBOX_TOKEN=...
   python3 data/pois/fetch_walksheds.py         --city <slug> --refresh
   python3 data/pois/fetch_pois.py              --city <slug> --refresh
   python3 data/pois/fetch_pois.py              --city <slug>
   python3 data/pois/fetch_walking_distances.py --city <slug> --refresh
   python3 data/pois/build_refined.py           --city <slug>
   python3 data/pois/build_stats.py             --city <slug>
   ```

   Order matters: `fetch_walking_distances` reads the per-category GeoJSONs
   that the plain `fetch_pois` build writes and that `build_refined` later
   replaces with tiles. Then add `CAP_WALKSHEDS` and `CAP_POIS`.

8. **Verify:**

   ```bash
   pytest data/pois/test_invariants.py data/test_process.py -q
   npm run test -- --run && npm run lint && npm run build
   ```

   Every data invariant is parametrized over the cities it applies to, and test
   ids carry the city slug, so a failure names the city it came from.

9. **Extend the monthly refresh** if the new city has Mapbox-backed data. The
   Overpass loops in `.github/workflows/data-refresh.yml` already drive
   themselves from the registry (`python3 data/cities.py --list pois`), but the
   Isochrone/Matrix stages are pinned to `--city seattle` deliberately: a
   walkshed refresh bumps the walkshed version and invalidates that city's
   entire Matrix cache, so it must never happen by accident.

## Honolulu's current state

Honolulu ships stations, the Skyline route, sprites and station exits. It does
**not** declare `walksheds` or `pois`: no Mapbox token was available when it was
added, and POI membership is defined by the isochrones. To finish it, run step 7
with `--city honolulu` and move the capabilities into `HONOLULU` in
`data/cities.py`.

One known wart: HART's published guideway centre line diverges from its own
station geometry near Honouliuli (Hoʻopili) by ~400 m, and the section has a
~1 km vertex gap there. The station coordinates are the trustworthy ones — they
agree with OSM's mapped platforms to within ~6 m — and they are what drives
walksheds; the deviation is cosmetic, affecting only the drawn route.
