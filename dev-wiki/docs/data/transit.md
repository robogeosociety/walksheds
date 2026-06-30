# Transit data (SDOT)

The route lines and stations come from the Seattle Department of Transportation (SDOT) open data, processed into the GeoJSON the app renders.

## Pipeline

```
data/raw/  ──►  data/process.py  ──►  public/*.geojson
```

`data/process.py` reads the committed raw SDOT GeoJSON and writes processed files into `public/`:

| Output | What it is |
| --- | --- |
| `line1-alignment.geojson` | Line 1 route, Chaikin-smoothed from SDOT points into a curved line. |
| `line2-alignment.geojson` | Line 2 route, same treatment. |
| `all-stations.geojson` | All 38 stations with stop codes, line assignments, and a shared flag. |

In the shared corridor (Lynnwood down to International District) Line 1 is offset west and Line 2 east, so the two routes render as distinct parallel strokes.

## Refresh

```bash
python3 data/process.py          # rebuild from committed raw data (no network)
python3 data/refresh.py          # re-download raw SDOT GeoJSON, then run process.py
```

`data/refresh.py` re-pulls the raw alignment and station GeoJSON from Seattle's ArcGIS endpoint. You only need it when Sound Transit publishes an update (new station opens, alignment correction). Everything else reads the committed raw files — no network required.

## Station data contract

`all-stations.geojson` is load-bearing for the whole app, so it is guarded by [INV-012](../invariants.md):

- Exactly **38** stations.
- Each has an integer `stopCode`.
- Each `lines` value is one of `"1"`, `"2"`, or `"1,2"`.

The two stations that share stop code 54 (Stadium on Line 1, Judkins Park on Line 2) are disambiguated downstream by the `{lines}-{stopCode}` key used across walksheds, distances, and exits.

## Tests

`data/test_process.py` covers alignment invariants and station-data integrity — the smoothing keeps the line topologically sane, the station count and code rules hold, and the shared-segment offsets are applied. See [Core invariants](../invariants.md) for the numbered contracts.
