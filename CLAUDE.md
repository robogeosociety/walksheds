# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Walksheds — a rail walkshed explorer. Interactive React SPA showing areas reachable within walking distance of rail stations, with Mapbox isochrone visualization.

**Multi-city.** Two cities ship today: **Seattle** (Sound Transit Link, 2 lines, 38 stations) and **Honolulu** (HART Skyline, 1 line, 13 open stations). Nothing outside the registry names a city — see "Cities" below and `docs/adding-a-city.md`.

## Design & House Style

This is a transit project; the visual language must look like real transit cartography — the classic stuff: Vignelli/Beck-lineage diagrams, clean line-colored routes, station roundels/pills, restrained sans-serif type, the official Sound Transit Link palette (1 Line `#38B030`, 2 Line `#00A0E0`). When adding or changing any UI, default to that idiom and reuse the existing station-pill / line-color vocabulary rather than inventing new ornament.

**No emoji.** Do not use emoji anywhere — not in the UI, popups, labels, docs, wiki, commit messages, or PR descriptions. They are not the house style. Use real iconography (inline SVG, the station sprite drawer) or plain typographic marks instead.

## Core Invariants

IDs are **append-only and stable** (`INV-NNN` — never reused; a retired invariant keeps its number). Most are checked by `data/pois/test_invariants.py` (CI job "Data invariants") and the JS suite (`src/__tests__/invariants.test.js`); some are enforced inline. **When adding an invariant, append the next `INV` number and a test — never renumber.**

- **INV-001 walkshed-listing** — every POI inside a station's 15-min walkshed lists ≥1 nearby station (non-empty `stations[]` / the popup's "Stations within a 15 min walk" section). Membership ⇒ a non-empty list; if Matrix can't route to a POI, fall back to a straight-line estimate rather than dropping it. Enforced by `verify_walkshed_invariant` in `data/pois/build_refined.py` and tested.
- **INV-002 poi-fields** — every POI has a non-empty `name`, a `category` in `VALID_CATEGORIES`, and a non-empty `tags[]`. (`validate_geojson`)
- **INV-003 unique-id** — POI `id` is unique within each category file. (`validate_geojson`)
- **INV-004 coords-in-bbox** — POI coordinates fall within the padded station bbox. (`validate_geojson`)
- **INV-005 stations-wellformed** — each `stations[]` entry has `stopCode, lines, name, walkingMeters, walkingSeconds, band`. (`validate_geojson`)
- **INV-006 no-orphan-tags** — every tag on any POI exists in `tag-categories.json` `tag_to_category`.
- **INV-007 stations-sorted** — `stations[]` is sorted ascending by `walkingSeconds`.
- **INV-008 provenance** — every POI carries a non-empty `sources ⊆ {osm, overture}`.
- **INV-009 cache-version-match** — the walking-distance cache `version` equals the walkshed dump `version`. (build warns/errors on mismatch)
- **INV-010 band-matches-geometry** — a POI's `stations[]` (stopCode, band) set equals its walkshed membership by point-in-polygon — no spurious/missing stations, correct band.
- **INV-011 distances-sane** — every `stations[]` entry has finite, non-negative meters/seconds and `band ∈ {5,10,15}`.
- **INV-012 station-data** — each city's `all-stations.geojson` has exactly `City.station_count` stations (Seattle 38, Honolulu 13); each has an integer `stopCode` and a `lines` value built from that city's line keys.
- **INV-013 sprite-per-station** — the sprite manifest has a light and dark icon for every station.
- **INV-014 deterministic-build** — regenerating the sprite manifest reproduces the committed one. (local test; needs `cairosvg`)
- **INV-015 registry-append-only** — `filter-registry.json` IDs are stable and unique; position is the ID, never reordered or reused.
- **INV-016 spotlight-references** — every spotlight pill's `matchCategories` / `matchTags` resolves to a real category / tag in the data. (JS suite)
- **INV-017 schema-registry-consistency** — `filter_schema` ID maps match `filter-registry.json` positions and cover every live tag.
- **INV-018 no-emoji** — no emoji anywhere (UI, docs, wiki, commits, PRs); see Design & House Style.
- **INV-019 tile-coverage** — the runtime streams POIs from a spatial grid (`public/cities/<slug>/pois/tiles/{col}_{row}.geojson` + `index.json`) instead of loading the full ~12 MB dataset. The union of all tiles must exactly equal the full POI set (no POI lost or duplicated), every feature must lie in its declared tile cell, and `index.json` must list precisely the populated tiles on disk. This keeps the full dataset (all tags, marginal POIs) while loading only the ~11 tiles overlapping the active walkshed (~20 KB). See `build_refined.py` `write_tiles` and `src/poiTiles.js`. (Surfacing marginal/just-outside POIs in the UI is tracked in issue #58.)
- **INV-020 station-tile-lookup** — `index.json` carries a precomputed `station_tiles` map (station key `{lines}-{stopCode}` → tile keys), so the runtime maps a selected station straight to its tiles without bbox math (it still clips against the live isochrone). For every station the lookup must include the tile of every POI inside that station's walkshed (a correct superset of membership), and every listed tile must be a real populated tile.
- **INV-021 station-exits-wellformed** — every feature in `public/station-exits.geojson` has a unique `id`, a `stationKey` resolving to a real station in `all-stations.geojson`, a non-empty `name`, a finite `bearingFromStation ∈ [0,360)`, `source ⊆ {osm}`, and coordinates inside the padded station bbox. (`test_invariants.py`)
- **INV-022 exit-nearest-station** — each exit's `stationKey` is the nearest Link station to its coordinates and within the build cutoff (`NEAREST_CUTOFF_M`), so the panel never lists an exit under a station a closer one should own. (`test_invariants.py`)
- **INV-023 stats-current** — `public/cities/<slug>/pois/stats.json` (the legend's expandable Statistics section: POI/station counts, data sources, freshness dates) matches a regeneration from the committed tile index, stations file, raw OSM dump, and pinned Overture release. Rebuild with `python3 data/pois/build_stats.py` after any data refresh. (`test_invariants.py`)
- **INV-024 city-registry-sync** — `src/cityRegistry.json` (what the frontend reads) matches `data/cities.py` (the source). Regenerate with `python3 data/cities.py`. (`test_invariants.py`, plus a named CI step)
- **INV-025 city-data-complete** — a city's declared `capabilities` match what is actually committed, **in both directions**: declaring `walksheds`/`pois`/`exits` requires the artifact, and having the artifact requires declaring it (otherwise the UI silently hides real data). `pois` additionally requires `walksheds`, since POI membership is defined by the isochrones. (`test_invariants.py`)

Every data invariant is parametrized over the cities it applies to, gated on capability; test ids carry the city slug, so a failure names the city.

## Commands

Most data scripts take `--city <slug>` (and many accept `--city all`). Omitting it uses the default city, `seattle`.

```bash
npm run dev           # Vite dev server on port 5187
npm run build         # Production build to dist/
npm run lint          # ESLint
npm run test          # Vitest unit tests (watch mode)
npm run test -- --run # Vitest unit tests (single run)
npm run e2e           # Playwright smoke tests
npm run preview       # Preview production build
python3 data/cities.py                   # Regenerate src/cityRegistry.json from the registry (INV-024)
python3 data/cities.py --list [CAP]      # Print city slugs (optionally only those with CAP) — CI drives its loops from this
python3 data/process.py                  # Regenerate every city's transit GeoJSON + sprites from committed raw data
python3 data/process.py --city honolulu  # ...for one city
uv run data/refresh.py --city all        # Re-download every city's rail feed from its agency, then reprocess
python3 data/pois/fetch_pois.py  # Rebuild POI GeoJSONs from committed OSM dump (no network)
python3 data/pois/fetch_pois.py --refresh  # Refetch OSM dump from Overpass, then rebuild
python3 data/pois/fetch_walksheds.py --refresh           # Refetch walkshed polygons from Mapbox Isochrone
python3 data/pois/fetch_walking_distances.py --refresh   # Refetch POI↔station walking distances from Mapbox Matrix
python3 data/pois/fetch_station_exits.py                 # Rebuild station-exits.geojson from the committed OSM entrance dump (no network)
python3 data/pois/fetch_station_exits.py --refresh       # Refetch station entrances from Overpass, then rebuild
python3 data/icons/fetch_app_icon.py                     # Rebuild iOS home-screen icons from the committed walksheds dump
python3 data/pois/build_stats.py                         # Rebuild each city's pois/stats.json (legend Statistics section; no network)
python3 data/pois/latest_overture_release.py             # Report the newest Overture release vs the pinned one (--apply to pin it)
python3 data/detect_station_changes.py                   # Diff the raw SDOT feed against the app's station set (Seattle only)
```

`cairosvg` needs the system cairo library. On this Mac there is no Homebrew — it comes from pixi (`pixi global install cairo`), and Python must be pointed at it:
`export DYLD_FALLBACK_LIBRARY_PATH="$HOME/.pixi/envs/cairo/lib"`. On CI it is `libcairo2` from apt.

Run the JS suite with `--pool=forks`; the default threads pool is pathologically slow on this machine (~2s vs ~8min).

## Cities

`data/cities.py` is the **single source of truth** for every city: map framing, lines (id/key/label/glyph/colors/sprite color), default station, station count, provenance, and `capabilities`. It generates `src/cityRegistry.json`, which `src/cities.js` imports — one registry, two consumers, INV-024 guards the sync. **Never hardcode a city anywhere else.**

**Capabilities** declare which datasets a city actually has: `walksheds` (Mapbox isochrones), `pois` (the tile grid — requires `walksheds`, since membership *is* the isochrone), `exits` (OSM entrances). The frontend hides the chrome for anything a city lacks, so a city can ship rail-only and gain walksheds later without the UI promising data that isn't there. INV-025 keeps the declaration honest in both directions.

| City | System | Lines | Stations | Capabilities |
| --- | --- | --- | --- | --- |
| `seattle` | Link Light Rail (Sound Transit) | 1 Line, 2 Line | 38 | walksheds, pois, exits |
| `honolulu` | Skyline (HART) | Skyline | 13 open | exits |

Honolulu has no walkshed isochrones yet — none could be built without a `MAPBOX_TOKEN` — so it also has no POIs. `docs/adding-a-city.md` has the finish-it runbook and the full add-a-city checklist.

**Layout.** Shared code stays put; only *data* is namespaced:

```
data/cities/<slug>/raw/            raw upstream feeds (committed)
data/cities/<slug>/raw/pois/       OSM / Mapbox dumps (committed, gzipped)
data/cities/<slug>/station-index.json
public/cities/<slug>/              everything the browser fetches
```

## Architecture

- **Frontend**: React + Vite + react-map-gl (Mapbox GL JS wrapper)
- **Map**: Mapbox Standard style, walksheds via Mapbox Isochrone API
- **Data**: each agency's station + alignment GeoJSON, processed by `data/process.py` (a city-agnostic driver) plus a per-city ingest module in `data/processors/<slug>.py`, into `public/cities/<slug>/`. Shared geometry is `data/geometry.py`; sprite sheets are `data/sprites.py`.
- **Active city**: resolved in `src/Walksheds.jsx` — a station deep link carries its own city in the path (`/honolulu/1/8`) and wins outright, then `?city=`, then `localStorage`. Published to leaf components via `src/cityContext.js` / `CityProvider.jsx`.
- **Station icons**: per-city sprite sheets under `public/cities/<slug>/icons/`, loaded and sliced at runtime (`src/stationIcons.js`), light/dark variants
- **Route graph**: `src/routeGraph.js` — station adjacency for keyboard/swipe navigation. Line order is **derived**, not hardcoded: each line's stations sorted by `stopCode` (an ordinal along the line in both cities), and the junction is the last station of the lines' common prefix. `src/__tests__/routeGraph.test.js` locks the derivation to Sound Transit's published order.

## Data Pipeline

### Transit (agency feed → public/cities/<slug>/)
Raw feeds in `data/cities/<slug>/raw/` → `data/process.py --city <slug>` → processed GeoJSON in `public/cities/<slug>/`. `data/process.py` is the city-agnostic driver (write outputs, derive the station index, render sprites, assert `station_count`); the ingest lives in `data/processors/<slug>.py` exposing `build(city) -> (stations, {line_id: alignment})`.

**Seattle** (`data/processors/seattle.py`, SDOT Transportation Plan feed):
- `line1-alignment.geojson` / `line2-alignment.geojson` — curved route lines (Chaikin-smoothed SDOT points)
- `all-stations.geojson` — 38 stations with stop codes, line assignments, shared flag
- Line 1 offset west, Line 2 offset east in the shared segment (Lynnwood → Intl District)
- Sound Transit's wiring is hardcoded here (`LINE_1_ORDER`, `STOP_CODES`, `MISSING_STATIONS`), so a new station needs human-judged edits — `data/detect_station_changes.py` only reports.

**Honolulu** (`data/processors/honolulu.py`, HART public ArcGIS layers):
- `all-stations.geojson` — the 13 stations in revenue service. HART's feed carries all 21 planned stations with an `ID` that is an authoritative west-to-east ordinal, so "open" is just `ID <= OPEN_STATION_MAX_ID`; opening Segment 3 is a one-number change plus a refresh.
- `line1-alignment.geojson` — the three open guideway sections' centre lines, stitched end-to-end (greedily, reversing as needed), trimmed to the open extent, then Douglas-Peucker simplified at 1 m (~6,000 survey vertices → ~240, 497 KB → 10 KB).
- Names: `name` is the official Hawaiian name (ʻokina normalised to U+02BB — the two HART fields disagree), `altName` is the place descriptor riders navigate by. Four stations carry a current-public-name override where the FEIS field is stale.

`data/refresh.py --city all` re-downloads each city's raw GeoJSON from its agency (only needed when the agency publishes updates), then runs `process.py`. Per-city endpoints and validators live in its `FEEDS` table. Everything else reads from the committed raw files — no network required.

### POIs (OSM → public/cities/<slug>/pois/)
Two phases, with the raw Overpass dump committed to the repo:

1. **Refresh** (needs network to `overpass-api.de`): `python3 data/pois/fetch_pois.py --refresh` runs one broad Overpass query covering every named node/way tagged with `amenity`/`tourism`/`leisure`/`shop` inside the station bbox, and writes `data/cities/<slug>/raw/pois/osm-pois.json.gz` (~1.5 MB for Seattle).
2. **Build** (no network, default): `python3 data/pois/fetch_pois.py` reads the committed raw dump, applies `CATEGORIES` filters + `extract_tags`, and writes per-category GeoJSONs to `public/cities/<slug>/pois/`.

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

Tag categorization is config-driven via `EXPLICIT_TAG_CATEGORIES` (category id → `{label, color, tags[]}`). Anything not enumerated falls through to `cuisine` (the default bucket). The build emits `public/cities/<slug>/pois/tag-categories.json` with `categories` (id → label/color) and `tag_to_category` (tag → category id) — the frontend fetches this and uses it for chip coloring + the legend color key.

Restaurants surface ~315 canonical tags (down from ~340 raw via alias compression); the frontend chip list (`getAvailableTags` in `src/poiUtils.js`) sorts by count desc, so common ones bubble up.

Per-feature properties on output GeoJSON: `id` (OSM node/way id), `name`, `category`, `tags[]`, plus optional `address`, `website`, `phone`, `hours`, `stations[]` (see below).

### Refined POIs (OSM + Overture → spatial tiles)

`data/pois/build_refined.py` is the production POI build: it conflates the OSM dump with Overture Places (best-of-both — Overture contact data, OSM hours + qualifier tags), attaches real Matrix `stations[]`, and emits the dataset **only as a spatial tile grid** under `public/cities/<slug>/pois/tiles/` (`{col}_{row}.geojson` + `index.json`), plus `tag-categories.json`. There are no per-category `public/cities/<slug>/pois/*.geojson` files — the app streams tiles per-walkshed (`src/poiTiles.js`), loading ~11 tiles (~20 KB) for the active station instead of the full ~12 MB set. The full dataset (all 26k POIs, all tags) is preserved across the tiles; INV-019 guards exact coverage. Re-run with `python3 data/pois/build_refined.py` (needs network for the Overture S3 query; OSM side reads the committed dump).

### Walksheds + POI walking distances (Mapbox → committed dumps)

Two committed dumps power the "Nearest stations" section of POI popups:

1. **`data/cities/<slug>/raw/pois/walksheds.json.gz`** — one Mapbox Isochrone call per station (38 stations × `contours_minutes=5,10,15`). Built by `python3 data/pois/fetch_walksheds.py --refresh`. Keyed by `f"{lines}-{stopCode}"` (disambiguates the two stations sharing stopCode 54). Includes a `version` (sha1) used to invalidate downstream caches.

2. **`data/cities/<slug>/raw/pois/walking-distances.json.gz`** — for every (station, POI) pair where the POI sits inside the station's 15-min isochrone, the walking distance + duration from Mapbox Matrix API. Built by `python3 data/pois/fetch_walking_distances.py --refresh`. Caches per pair, so re-running is incremental. Re-running with a new walkshed version invalidates the whole cache.

`python3 data/pois/fetch_pois.py` (default, offline) attaches a sorted `stations: [{stopCode, lines, name, walkingMeters, walkingSeconds, band}, …]` array to each POI feature using both dumps. POIs outside every 15-min walkshed simply lack the array. If the dumps don't exist, the build runs without the array and prints a hint to refresh.

**Refresh order when POIs change:** `fetch_pois.py --refresh` → `fetch_walking_distances.py --refresh` (the latter re-fetches Matrix entries for any new POI ids inside a walkshed). `fetch_walksheds.py --refresh` is only needed when station coordinates change.

**Mapbox token for refresh scripts:** set `MAPBOX_TOKEN` (or `MAPBOX_ACCESS_TOKEN`) in the environment. Public (`pk.`) and secret (`sk.`) tokens have identical capability for Isochrone + Matrix (both are read endpoints); the practical reason for a build-only token is URL restrictions — if the browser-side `VITE_MAPBOX_ACCESS_TOKEN` is restricted to `walksheds.xyz`, calls from a Python script will fail the referrer check. Easiest fix: add the build host's URL (or leave unrestricted) on that token, or mint a separate token for the scripts.

### Automated monthly refresh (.github/workflows/data-refresh.yml)

A scheduled workflow (26th monthly, ~10 days after Overture's mid-month release; also `workflow_dispatch` with `dry_run` / `skip_overture` / `force_walksheds` / `branch_suffix` inputs) refreshes the whole pipeline and opens a PR for human review on branch `data-refresh/YYYY-MM` (same-month reruns update the same branch; older open refresh PRs are closed as superseded). Step order is load-bearing:

1. `data/refresh.py --city all` (every agency feed + reprocess) → `data/detect_station_changes.py` (Seattle) (new-station detection vs HEAD baseline) → geometry-only coordinate-change check.
2. `fetch_pois.py --refresh` + `fetch_station_exits.py --refresh` (Overpass, with retries), looped over the cities the registry says have each capability (`python3 data/cities.py --list pois` / `--list exits`).
3. `fetch_walksheds.py --city seattle --refresh` **only if Seattle station coordinates changed** (or `force_walksheds`) — a walkshed version bump invalidates the entire Matrix cache, so it must never happen needlessly.
4. `fetch_pois.py` (per-category build the Matrix step reads) → `fetch_walking_distances.py --refresh` (incremental top-up).
5. `data/pois/latest_overture_release.py --apply` (anonymous S3 discovery; accepts a release only if its places theme exists on S3; degrades to the current pin on any failure) → `build_refined.py` → `build_stats.py`.
6. Full validation (invariant suite, `data/test_process.py`, JS tests, lint, build) runs **before** anything is pushed — no partial state ever reaches the remote.

The PR body is authored by a second job via `anthropics/claude-code-action@v1` pinned to `claude-sonnet-5` (newspaper format, passes the `pr-newspaper` gate; PR created under the Claude GitHub App token so ci.yml triggers normally). A detected new station is flagged prominently in the PR and escalated as a GitHub issue enumerating the hardcoded touch points (`LINE_*_ORDER`, `STOP_CODES`, `MISSING_STATIONS`, `SEATTLE.station_count`, sprites); the workflow itself never edits `data/processors/seattle.py`, and the issue requires a human "@claude proceed" comment to start the follow-up (default-token issues do not trigger claude.yml).

### Station exits/entrances (OSM → public/cities/<slug>/station-exits.geojson)

`public/cities/<slug>/station-exits.geojson` is a flat point set of station exits/entrances rendered as **floating green "EXIT" badges** on the map (`src/StationExitMarkers.jsx`) — one over each exit of the selected station, above the POI dots and below the station pill, with a label from the exit ref or compass bearing. When a POI popup is open, the exit physically closest to it turns orange ("best exit"). Two phases mirror the POI pipeline, with the raw Overpass dump committed:

1. **Refresh** (needs network to `overpass-api.de`): `python3 data/pois/fetch_station_exits.py --refresh` runs one Overpass query for every `railway=subway_entrance` / `railway=train_station_entrance` node in the station bbox, writing `data/cities/<slug>/raw/pois/station-exits.json.gz`.
2. **Build** (no network, default): `python3 data/pois/fetch_station_exits.py` reads the dump, assigns each entrance to its nearest station (within 400 m; drops unrelated nodes), precomputes `bearingFromStation`, and writes `public/cities/<slug>/station-exits.geojson`.

Per-feature properties: `id` (OSM node id), `stationKey` (`{lines}-{stopCode}`), `stationName`, `name`, `bearingFromStation` (degrees, 0 = north), optional `accessible` (`wheelchair=yes`), `source` (`osm`). **Best-exit logic** is straight-line nearest (haversine), computed live in the browser (`nearestExit` in `src/stationExits.js`) — no API cost. **Coverage varies by city**: Seattle ~33/38 stations (the newest south + east-end stations have none mapped yet, so no badges show for them); Honolulu 21 exits across 13/13. Neither city has another subway, so `subway_entrance` nodes are effectively all the city's rail; nearest-station assignment also disambiguates Seattle's two stations sharing stopCode 54 (Stadium / Judkins Park).

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

## Embedding

The app is embeddable in other sites/dashboards as an iframe served from `walksheds.xyz` (iframe — not a JS bundle — because the Mapbox token is origin-restricted and framing isolates CSS/global state). `?embed=1` parses a frozen config (`src/embedConfig.js`) that strips onboarding/branding chrome, stops writing to the URL + `localStorage` (the frame shares the real site's origin storage), and opens a two-way `postMessage` bridge (`src/embedBridge.js`, `useEmbedBridge`). Chrome is gated by JSX (legend/search), `LineLegend` `show*` props (help/guide/dark toggles), and `.app` CSS modifier classes (`embed-hide-report`, `embed-hide-locate`). Host helper + live demo: `public/embed.js`, `public/embed.html`. Full reference: `wiki/codex/docs/embedding.md`.

## Testing

- **JS unit tests**: Vitest + jsdom + React Testing Library (`src/__tests__/`)
- **Route graph tests**: `src/__tests__/routeGraph.test.js` — navigation, junctions, bearings
- **Data processing tests**: `data/test_process.py` — alignment invariants, station data integrity, per-city processor behavior (Seattle's shared-trunk offset; Honolulu's open-segment cutoff, guideway stitching, ʻokina normalisation)
- **E2E**: Playwright chromium (`e2e/smoke.spec.js`)
- **Linting**: ESLint

## Ports & Credentials

- Vite dev server: **5187** (registered in `~/.claude/vite-ports.json`)
- Mapbox token: `.env` → `VITE_MAPBOX_ACCESS_TOKEN`; managed in `~/.mapbox/credentials` under `[walksheds]`
- `cairosvg` needs system cairo. No Homebrew on this Mac — it comes from pixi: `pixi global install cairo`, then `export DYLD_FALLBACK_LIBRARY_PATH="$HOME/.pixi/envs/cairo/lib"`

## Mapbox Style

Base: `mapbox://styles/mapbox/standard` with `theme: 'default'`, `lightPreset: 'day'`. Dark mode toggles to `lightPreset: 'dusk'`.

## Station Codes — Seattle (Sound Transit Reference)

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

## Station Codes — Honolulu (HART Reference)

Reference: <https://honolulutransit.org/about/stations/>
Feeds: `HART_Transit_Stations_PUBLIC` / `HART_Guideway_Alignment_Line_PUBLIC` on
<https://honolulu-cchnl.opendata.arcgis.com/>

`stopCode` is HART's own `ID` — a west-to-east ordinal over all 21 planned
stations, so the unopened City Center segment already holds 14–21 and opening it
never renumbers anything. Stations carry the official Hawaiian `name` and an
English `altName`.

**Open (Segment 1, 2023-06-30):** 1=Kualakaʻi (East Kapolei), 2=Keoneʻae (UH West Oʻahu),
3=Honouliuli (Hoʻopili), 4=Hōʻaeʻae (West Loch), 5=Pouhala (Waipahu Transit Center),
6=Hālaulani (Leeward Community College), 7=Waiawa (Pearl Highlands), 8=Kalauao (Pearlridge),
9=Hālawa (Aloha Stadium)

**Open (Segment 2, 2025-10-16):** 10=Makalapa (Pearl Harbor / Hickam),
11=Lelepaua (Daniel K. Inouye International Airport), 12=Āhua (Lagoon Drive),
13=Kahauiki (Middle Street Transit Center)

**Under construction (Segment 3, City Center):** 14=Mokauea (Kalihi), 15=Niuhelewai (Kapālama),
16=Kūwili (Iwilei), 17=Hōlau (Chinatown), 18=Kuloloia (Downtown),
19=Kaʻākaukukui (Civic Center), 20=Kūkuluaeʻo (Kakaʻako), 21=Kālia (Ala Moana Center)

To open them: raise `OPEN_STATION_MAX_ID` in `data/processors/honolulu.py`, add
`"City Center Section"` to `OPEN_SECTIONS`, update `HONOLULU.station_count`, and
re-run the refresh.
## Pull requests — the "newspaper" framework

PR descriptions follow the **newspaper / information-pyramid** format: one self-contained
front page (kicker → headline → dek → masthead → why → what → mermaid flow → screens →
verification → risk) that reads top-to-bottom on an iPad-mini portrait display (1–2 pages;
up to 4 for very complex *code* changes). Rebuild from the **full** diff, never append.
Full rules: <https://github.com/robogeosociety/.github/blob/main/PR_FRAMEWORK.md>. CI validates
the body via the `pr-newspaper` workflow (the reusable gate in `robogeosociety/pr-newspaper`).
