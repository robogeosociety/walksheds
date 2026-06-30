# Points of interest (OSM)

The POI layer starts from OpenStreetMap. `fetch_pois.py` is the simpler, OSM-only build; the production build that ships the tile grid is [Refined POIs](refined-pois.md). Both read the same committed Overpass dump.

## Two phases

```mermaid
flowchart LR
  OVP[Overpass API<br/>overpass-api.de] -->|--refresh| DUMP[osm-seattle.json.gz<br/>~1.5 MB, committed]
  DUMP -->|default, no network| BUILD[fetch_pois.py]
  BUILD --> GEO[public/pois/*.geojson]
```

1. **Refresh** (needs network): `python3 data/pois/fetch_pois.py --refresh` runs one broad Overpass query for every named node/way tagged `amenity` / `tourism` / `leisure` / `shop` inside the station bbox, and writes `data/pois/raw/osm-seattle.json.gz`.
2. **Build** (default, no network): `python3 data/pois/fetch_pois.py` reads the committed dump, applies the `CATEGORIES` filters and `extract_tags`, and writes per-category GeoJSON.

## Adding a category

1. Edit `CATEGORIES` in `data/pois/fetch_pois.py`. The `osm_key` must already be in `RAW_KEYS`.
2. Run `python3 data/pois/fetch_pois.py` — rebuilds from the committed dump, no network.
3. Wire the category into `src/constants.js`. Commit.

Only add a new key to `RAW_KEYS` and run `--refresh` if the new category uses an OSM tag key the dump does not already cover.

## Tag extraction is config-driven

`extract_tags` turns raw OSM tags into the canonical tag set the UI filters on. It is driven entirely by config tables, so exposing a new tag is a data edit, not a code change:

| Table | Purpose | Example |
| --- | --- | --- |
| `BOOL_TAG_FIELDS` | `{osm_field: (tag_name, accepted_values)}` for boolean qualifiers | `microbrewery=yes` → `microbrew` |
| `MULTI_VALUE_FIELDS` | semicolon-split fields, each value its own tag | `cuisine`, `sport` |
| `VALUE_AS_TAG_FIELDS` | the field's value *is* the tag | `craft` → `brewery`, `distillery` |
| `TAG_ALIASES` | `{raw: canonical}` synonym/typo collapse, applied after normalization | `kabob` → `kebab`, `boba` → `bubble-tea` |

Normalization (`_normalize`) lowercases, ASCII-folds, and hyphenates spaces/underscores before aliasing. Pass `--no-normalize` to bypass.

Restaurants surface roughly 315 canonical tags (compressed from about 340 raw via aliasing). The frontend chip list (`getAvailableTags` in `src/poiUtils.js`) sorts by descending count, so the common tags bubble to the top.

## Tag categorization and coloring

`EXPLICIT_TAG_CATEGORIES` maps category id → `{label, color, tags[]}`. Anything not enumerated falls through to the `cuisine` bucket (the default). The build emits `public/pois/tag-categories.json` with:

- `categories` — id → label + color, for the legend color key.
- `tag_to_category` — tag → category id, for chip coloring.

The frontend fetches this file and uses it for both the chip colors and the legend. Every tag in the data must resolve to a category here — that is [INV-006](../invariants.md) (no orphan tags).

## Per-feature output

Each POI feature carries:

`id` (OSM node/way id), `name`, `category`, `tags[]`, plus optional `address`, `website`, `phone`, `hours`, and the `stations[]` array (the nearby stations with walking distances — see [Walksheds](walksheds.md)).

These fields are guarded by [INV-002](../invariants.md) (non-empty name, valid category, non-empty tags), [INV-003](../invariants.md) (unique id per category file), and [INV-008](../invariants.md) (provenance — every POI carries a non-empty `sources` subset of `{osm, overture}`).
