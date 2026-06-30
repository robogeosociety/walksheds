# Commands

Every entry point, grouped by what it does. Frontend commands are npm scripts; the data pipeline is Python (run with `python3`).

## Frontend

```bash
npm run dev            # Vite dev server on port 5187
npm run build          # production build to dist/
npm run preview        # preview the production build
npm run lint           # ESLint
npm run test           # Vitest unit tests (watch mode)
npm run test -- --run  # Vitest unit tests (single run)
npm run e2e            # Playwright smoke tests
```

## Transit data

```bash
python3 data/process.py   # regenerate transit GeoJSON from committed raw SDOT data
python3 data/refresh.py   # re-download raw SDOT GeoJSON from Seattle ArcGIS, then run process.py
```

## POIs

```bash
python3 data/pois/fetch_pois.py             # rebuild POI GeoJSON from the committed OSM dump (no network)
python3 data/pois/fetch_pois.py --refresh   # refetch the OSM dump from Overpass, then rebuild
python3 data/pois/build_refined.py          # production build: OSM + Overture conflation, emits the tile grid
```

## Walksheds + walking distances

```bash
python3 data/pois/fetch_walksheds.py --refresh           # refetch walkshed polygons from Mapbox Isochrone
python3 data/pois/fetch_walking_distances.py --refresh   # refetch POI to station walking distances from Mapbox Matrix
```

## Station exits

```bash
python3 data/pois/fetch_station_exits.py             # rebuild station-exits.geojson from the committed dump (no network)
python3 data/pois/fetch_station_exits.py --refresh   # refetch entrances from Overpass, then rebuild
```

## Icons

```bash
python3 data/icons/fetch_app_icon.py   # rebuild iOS home-screen icons from the committed walksheds dump
```

## Tests at a glance

| Suite | Command | Covers |
| --- | --- | --- |
| JS unit | `npm run test -- --run` | components, route graph, invariants (`src/__tests__/`) |
| E2E | `npm run e2e` | Playwright chromium smoke (`e2e/smoke.spec.js`) |
| Data | `python3 -m pytest data/` | alignment + station integrity (`data/test_process.py`), data invariants (`data/pois/test_invariants.py`) |
| Lint | `npm run lint` | ESLint |

!!! tip "Refresh order"
    When POIs change: `fetch_pois.py --refresh` → `fetch_walking_distances.py --refresh`. Only refresh walksheds when station coordinates move. See [Data overview](data/overview.md).
