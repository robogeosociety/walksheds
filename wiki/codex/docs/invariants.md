# Core invariants

Invariants are the data and design contracts that keep Walksheds honest. They are identified `INV-NNN` and are **append-only and stable**: a number is never reused, and a retired invariant keeps its number. When you add one, append the next number and a test — never renumber.

Most are checked by `data/pois/test_invariants.py` (the CI job "Data invariants") and the JS suite (`src/__tests__/invariants.test.js`); a few are enforced inline in the build.

!!! tip "Adding an invariant"
    1. Append the next `INV` number (do not reuse a retired one).
    2. Add a test — `test_invariants.py` for data, `invariants.test.js` for frontend, or an inline build check.
    3. Document it here and in `CLAUDE.md`. See [Contributing](contributing.md).

## The catalog

### Data integrity

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-001 | walkshed-listing | Every POI inside a station's 15-min walkshed lists at least one nearby station. Membership implies a non-empty list; if Matrix can't route, fall back to a straight-line estimate rather than dropping the POI. | `verify_walkshed_invariant` in `build_refined.py` + test |
| INV-002 | poi-fields | Every POI has a non-empty `name`, a `category` in `VALID_CATEGORIES`, and a non-empty `tags[]`. | `validate_geojson` |
| INV-003 | unique-id | POI `id` is unique within each category file. | `validate_geojson` |
| INV-004 | coords-in-bbox | POI coordinates fall within the padded station bbox. | `validate_geojson` |
| INV-005 | stations-wellformed | Each `stations[]` entry has `stopCode`, `lines`, `name`, `walkingMeters`, `walkingSeconds`, `band`. | test |
| INV-006 | no-orphan-tags | Every tag on any POI exists in `tag-categories.json` `tag_to_category`. | test |
| INV-007 | stations-sorted | `stations[]` is sorted ascending by `walkingSeconds`. | test |
| INV-008 | provenance | Every POI carries a non-empty `sources`, a subset of `{osm, overture}`. | test |

### Geometry + distances

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-009 | cache-version-match | The walking-distance cache `version` equals the walkshed dump `version`. | build warns/errors on mismatch |
| INV-010 | band-matches-geometry | A POI's `stations[]` (stopCode, band) set equals its walkshed membership by point-in-polygon — no spurious or missing stations, correct band. | test |
| INV-011 | distances-sane | Every `stations[]` entry has finite, non-negative meters/seconds and `band` in `{5, 10, 15}`. | test |
| INV-012 | station-data | `all-stations.geojson` has exactly 38 stations; each has an integer `stopCode` and `lines` in `{"1", "2", "1,2"}`. | test |

### Sprites + assets

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-013 | sprite-per-station | The sprite manifest has a light and dark icon for every station. | test |
| INV-014 | deterministic-build | Regenerating the sprite manifest reproduces the committed one. | local test (needs `cairosvg`) |

### Tiling

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-019 | tile-coverage | The union of all tiles exactly equals the full POI set (no POI lost or duplicated); every feature lies in its declared tile cell; `index.json` lists precisely the populated tiles on disk. | test |
| INV-020 | station-tile-lookup | `index.json` carries a `station_tiles` map (station key → tile keys) that includes the tile of every POI inside each station's walkshed (a correct superset), and every listed tile is a real populated tile. | test |

### Filters + spotlight

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-015 | registry-append-only | `filter-registry.json` IDs are stable and unique; position is the ID, never reordered or reused. | test |
| INV-016 | spotlight-references | Every spotlight pill's `matchCategories` / `matchTags` resolves to a real category / tag in the data. | JS suite |
| INV-017 | schema-registry-consistency | `filter_schema` ID maps match `filter-registry.json` positions and cover every live tag. | test |

### House style

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-018 | no-emoji | No emoji anywhere — UI, docs, wiki, commits, PRs. See [Design system](design-system.md). | test |

### Station exits

| ID | Name | Contract | Enforced by |
| --- | --- | --- | --- |
| INV-021 | station-exits-wellformed | Every exit has a unique `id`, a `stationKey` resolving to a real station, a non-empty `name`, a finite `bearingFromStation` in `[0, 360)`, `source` a subset of `{osm}`, and coords inside the padded bbox. | `test_invariants.py` |
| INV-022 | exit-nearest-station | Each exit's `stationKey` is the nearest Link station to its coordinates and within `NEAREST_CUTOFF_M`. | `test_invariants.py` |

!!! info "Numbering vs. ordering"
    The tables above group invariants by theme, so they are not in numeric order — INV-015 through INV-017 (filters) sit after INV-019/INV-020 (tiling) here. The numbers themselves are assigned in append-only creation order. All of INV-001 through INV-022 are live; if a number were ever retired, its slot would stay reserved forever rather than being reused.
