# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Walksheds — Seattle light rail walkshed explorer. Interactive React SPA showing areas reachable within walking distance of Link Light Rail stations, with Mapbox isochrone visualization.

## Design & House Style

This is a transit project; the visual language must look like real transit cartography — the classic stuff: Vignelli/Beck-lineage diagrams, clean line-colored routes, station roundels/pills, restrained sans-serif type, the established Link light rail palette (1 Line `#4CAF50`, 2 Line `#0082C8`). When adding or changing any UI, default to that idiom and reuse the existing station-pill / line-color vocabulary rather than inventing new ornament.

**No emoji.** Do not use emoji anywhere — not in the UI, popups, labels, docs, wiki, commit messages, or PR descriptions. They are not the house style. Use real iconography (inline SVG, the station sprite drawer) or plain typographic marks instead.

## Commands

```bash
npm run dev           # Vite dev server on port 5187
npm run build         # Production build to dist/
npm run lint          # ESLint
npm run test          # Vitest unit tests (watch mode)
npm run test -- --run # Vitest unit tests (single run)
npm run e2e           # Playwright smoke tests
npm run preview       # Preview production build
python3 data/process.py          # Regenerate transit GeoJSON from SDOT raw data
python3 data/pois/fetch_pois.py  # Rebuild POI GeoJSONs from committed OSM dump (no network)
python3 data/pois/fetch_pois.py --refresh  # Refetch OSM dump from Overpass, then rebuild
```

## Architecture

- **Frontend**: React + Vite + react-map-gl (Mapbox GL JS wrapper)
- **Map**: Mapbox Standard style, walksheds via Mapbox Isochrone API
- **Data**: SDOT alignment + station GeoJSON processed via `data/process.py` into `public/` static files
- **Station icons**: SVG pill markers generated at runtime (`src/stationIcons.js`), light/dark variants
- **Route graph**: `src/routeGraph.js` — station adjacency for keyboard/swipe navigation along lines

## Data Pipeline

### Transit (SDOT → public/)
Raw SDOT data in `data/raw/` → `data/process.py` → processed GeoJSON in `public/`:
- `line1-alignment.geojson` / `line2-alignment.geojson` — curved route lines (Chaikin-smoothed SDOT points)
- `all-stations.geojson` — 38 stations with stop codes, line assignments, shared flag
- Line 1 offset west, Line 2 offset east in the shared segment (Lynnwood → Intl District)

`data/refresh.py` re-downloads the raw SDOT GeoJSON from Seattle ArcGIS (only needed when Sound Transit publishes updates), then runs `process.py`. Everything else reads from the committed raw files — no network required.

### POIs (OSM → public/pois/)
Two phases, with the raw Overpass dump committed to the repo:

1. **Refresh** (needs network to `overpass-api.de`): `python3 data/pois/fetch_pois.py --refresh` runs one broad Overpass query covering every named node/way tagged with `amenity`/`tourism`/`leisure`/`shop` inside the station bbox, and writes `data/pois/raw/osm-seattle.json.gz` (~1.5 MB).
2. **Build** (no network, default): `python3 data/pois/fetch_pois.py` reads the committed raw dump, applies `CATEGORIES` filters + `extract_tags`, and writes per-category GeoJSONs to `public/pois/`.

Adding a new POI category:
1. Edit `CATEGORIES` in `data/pois/fetch_pois.py`. The osm_key must be in `RAW_KEYS`.
2. Run `python3 data/pois/fetch_pois.py` — rebuilds from the committed dump, no network.
3. Wire into `src/constants.js`. Commit.

Only add a new key to `RAW_KEYS` + run `--refresh` if a new category uses an OSM tag key not already covered by the dump.

Tag extraction (`extract_tags` in `fetch_pois.py`) is config-driven:
- `BOOL_TAG_FIELDS` — `{osm_field: (tag_name, accepted_values)}` for boolean qualifiers (e.g. `microbrewery=yes` → "microbrew"). Add a row to expose a new tag — no code changes needed.
- `MULTI_VALUE_FIELDS` — semicolon-split fields where each value becomes its own tag (`cuisine`, `sport`).
- `VALUE_AS_TAG_FIELDS` — fields where the value itself is the tag (`craft` → "brewery", "distillery").
- `TAG_ALIASES` — `{raw: canonical}` synonym/typo collapse map applied after `_normalize` (lowercase + ASCII-fold + space/underscore-hyphenate). E.g. `kabob` → `kebab`, `boba` → `bubble-tea`. Pass `--no-normalize` to the build script to bypass.

Tag categorization is config-driven via `EXPLICIT_TAG_CATEGORIES` (category id → `{label, color, tags[]}`). Anything not enumerated falls through to `cuisine` (the default bucket). The build emits `public/pois/tag-categories.json` with `categories` (id → label/color) and `tag_to_category` (tag → category id) — the frontend fetches this and uses it for chip coloring + the legend color key.

Restaurants surface ~315 canonical tags (down from ~340 raw via alias compression); the frontend chip list (`getAvailableTags` in `src/poiUtils.js`) sorts by count desc, so common ones bubble up.

Per-feature properties on output GeoJSON: `id` (OSM node/way id), `name`, `category`, `tags[]`, plus optional `address`, `website`, `phone`, `hours`.

## Deployment

React SPA deployed to GitHub Pages via `.github/workflows/deploy.yml` on push to main. Served from `https://walksheds.xyz` (custom domain). The domain binding lives in `public/CNAME` (Vite copies it into `dist/` at build time; GitHub Pages reads it on deploy). DNS for `walksheds.xyz` is managed in Cloudflare via the Terraform module in `infra/` — see `infra/README.md`.

### Pointing the live site at a PR branch

To preview a branch on the live Pages URL (overrides main until the next main push), add a per-branch workflow file:

1. Sanitize the branch name: `/` → `-`, strip anything outside `[a-zA-Z0-9._-]`.
2. Create `.github/workflows/deploy-preview-<sanitized>.yml` on the branch, modeled on existing previews (e.g. `deploy-preview-claude-add-dispensary-category-MYKXl.yml`). Key bits:
   - `on.push.branches: ['<exact-branch-name>']` + `workflow_dispatch:`
   - `concurrency.group: pages` (shared with `deploy.yml` so they serialize — latest finished deploy wins)
   - Same build + `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` jobs as `deploy.yml`
3. Commit + push to the branch — auto-fires and replaces the live site.
4. `cleanup-merged-preview.yml` on main deletes the file on PR merge, so previews don't accumulate.

The next push to `main` will re-deploy main's build via `deploy.yml` and overwrite the preview.

## Testing

- **JS unit tests**: Vitest + jsdom + React Testing Library (`src/__tests__/`)
- **Route graph tests**: `src/__tests__/routeGraph.test.js` — navigation, junctions, bearings
- **Data processing tests**: `data/test_process.py` — alignment invariants, station data integrity
- **E2E**: Playwright chromium (`e2e/smoke.spec.js`)
- **Linting**: ESLint

## Ports & Credentials

- Vite dev server: **5187** (registered in `~/.claude/vite-ports.json`)
- Mapbox token: `.env` → `VITE_MAPBOX_ACCESS_TOKEN`; managed in `~/.mapbox/credentials` under `[walksheds]`

## Mapbox Style

Base: `mapbox://styles/mapbox/standard` with `theme: 'default'`, `lightPreset: 'day'`. Dark mode toggles to `lightPreset: 'dusk'`.

## Station Codes (Sound Transit Reference)

Reference: https://www.soundtransit.org/ride-with-us/stations/link-light-rail-stations
Blog post: https://www.soundtransit.org/blog/platform/understanding-sound-transits-new-three-digit-station-codes
Screenshots: `data/reference/soundtransit-stations.png`, `data/reference/soundtransit-station-codes.png`

Sound Transit uses three-digit station codes: first digit = line number, last two digits = stop code.
Westlake (center) = 50. Numbers increase south/east, decrease north. Gaps reserved for future infill stations.

**Shared stations (both lines):**
40=Lynnwood City Center, 41=Mountlake Terrace, 42=Shoreline North/185th, 43=Shoreline South/148th,
[44=NE 130th St, future], 45=Northgate, 46=Roosevelt, 47=U District, 48=UW,
49=Capitol Hill, 50=Westlake, 51=Symphony, 52=Pioneer Square, 53=Intl District/Chinatown

**Line 1 only (south):**
54=Stadium, 55=SODO, 56=Beacon Hill, 57=Mount Baker, 58=Columbia City,
[59=Graham St, future], 60=Othello, 61=Rainier Beach, [62=Boeing Access Rd, future],
63=Tukwila Intl Blvd, 64=SeaTac/Airport, 65=Angle Lake, 66=Kent Des Moines, 67=Star Lake, 68=Federal Way Downtown

**Line 2 only (east):**
54=Judkins Park, 55=Mercer Island, 56=South Bellevue, 57=East Main, 58=Bellevue Downtown,
59=Wilburton, 60=Spring District, 61=BelRed, 62=Overlake Village, 63=Redmond Technology,
64=Marymoor Village, 65=Downtown Redmond
