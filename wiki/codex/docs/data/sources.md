# Data sources & formats

A single-page catalog of **where every byte on the map comes from** and **what shape it takes** at each stage — the external providers, their endpoints and auth, the raw dumps they feed, and the formats emitted into `public/`.

This is the reference index. For how each source is built step by step, follow the per-stage pages linked in the last column; for the build philosophy, see the [pipeline overview](overview.md).

## External sources at a glance

| Source | Provider | Endpoint / origin | Auth | Refreshed by | Deep dive |
| --- | --- | --- | --- | --- | --- |
| Light-rail alignment + stations | Sound Transit / SDOT (Seattle ArcGIS) | `services.arcgis.com/…/arcgis/rest/services` | none | `data/refresh.py` | [Transit](transit.md) |
| POIs | OpenStreetMap (Overpass) | `overpass-api.de/api/interpreter` | none | `fetch_pois.py --refresh` | [POIs](pois.md) |
| POI contact data | Overture Maps `places` theme | `s3://overturemaps-us-west-2/release/<rel>/theme=places` (DuckDB-over-S3) | none (anonymous S3) | `build_refined.py` | [Refined POIs](refined-pois.md) |
| Walkshed polygons | Mapbox Isochrone | `api.mapbox.com/isochrone/v1/mapbox/walking` | `MAPBOX_TOKEN` | `fetch_walksheds.py --refresh` | [Walksheds](walksheds.md) |
| POI↔station walking distances | Mapbox Matrix | `api.mapbox.com/directions-matrix/v1/mapbox/walking` | `MAPBOX_TOKEN` | `fetch_walking_distances.py --refresh` | [Walksheds](walksheds.md) |
| Station entrances/exits | OpenStreetMap (Overpass) | `overpass-api.de/api/interpreter` | none | `fetch_station_exits.py --refresh` | [Station exits](station-exits.md) |

Five providers, six feeds (OSM appears twice — POIs and station entrances are separate Overpass queries and separate dumps).

## The two-phase pattern

Every source splits into a networked **refresh** and an offline **build**:

- **Refresh** (`--refresh`, needs network) re-pulls from upstream and rewrites a committed raw dump.
- **Build** (default, no network) reads the committed dump and produces the `public/` asset deterministically.

The consequence: **a normal build needs no API keys and no network.** CI and contributors reproduce the exact dataset; a refresh is an explicit, reviewable diff of what changed upstream. See [Why dumps are committed](overview.md#why-dumps-are-committed).

## Formats used

| Format | Used for |
| --- | --- |
| **GeoJSON** (`.geojson`) | All map layers — line alignments, stations, POI tiles, station exits, raw SDOT input |
| **Gzipped JSON** (`.json.gz`) | Committed raw dumps (`osm-seattle`, `walksheds`, `walking-distances`, `station-exits`) |
| **Plain JSON** (`.json`) | Config + indexes — `tag-categories.json`, tile `index.json`, `filter-registry.json`, `station-index.json` |
| **TOML** (`.toml`) | `tag-aliases.toml` — the alias/synonym collapse map |
| **PNG** | Generated icons — iOS home-screen icons, the OG share card |

## Source by source

### Sound Transit / SDOT — via Seattle ArcGIS

- **Provides:** the raw light-rail route geometry and station points for all 38 Link stations.
- **Endpoint:** Seattle's public ArcGIS REST feature services (no auth). Pulled only when Sound Transit publishes updates.
- **Raw dumps:** `data/raw/light-rail-alignment.geojson`, `data/raw/light-rail-stations.geojson`.
- **Build:** `data/process.py` Chaikin-smooths the alignment, offsets Line 1 west / Line 2 east in the shared Lynnwood→Intl District trunk, and assigns stop codes + line membership.
- **Outputs:** `public/line1-alignment.geojson`, `public/line2-alignment.geojson`, `public/all-stations.geojson`.

### OpenStreetMap — POIs (Overpass)

- **Provides:** every named node/way tagged `amenity` / `tourism` / `leisure` / `shop` inside the padded station bbox, with rich qualifier tags (cuisine, diet, service style, opening hours).
- **Endpoint:** `overpass-api.de/api/interpreter`, one broad query (no auth, rate-limited — hence the committed dump).
- **Raw dump:** `data/pois/raw/osm-seattle.json.gz` (~1.5 MB).
- **Build:** `fetch_pois.py` (per-category legacy) and `build_refined.py` (production conflation). Tag extraction is config-driven — see [POIs](pois.md).

### Overture Maps — Places

- **Provides:** high-coverage contact data (website, phone, address) that OSM lacks, merged into OSM records during conflation.
- **Origin:** the public Overture S3 release bucket, queried with **DuckDB over S3** clipped to the station bbox — no full download, no auth. The release is pinned in `fetch_overture.py` (`RELEASE`).
- **Build:** `build_refined.py` clusters same-place records across both sources (same normalized name within ~80 m). **Overture wins** website/phone/address; **OSM wins** hours + qualifier tags; **tags union**; a `sources` provenance list records which fed each POI. See [Refined POIs](refined-pois.md).

### Mapbox — Isochrone (walksheds)

- **Provides:** the 5-, 10-, and 15-minute walking-time polygons drawn around each station.
- **Endpoint:** `api.mapbox.com/isochrone/v1/mapbox/walking` — one call per station × `contours_minutes=5,10,15`. Needs `MAPBOX_TOKEN`.
- **Raw dump:** `data/pois/raw/walksheds.json.gz`, keyed `{lines}-{stopCode}` (disambiguates the two stations sharing stopCode 54), carrying a `version` sha1 that invalidates downstream caches ([INV-009](../invariants.md)).

### Mapbox — Matrix (walking distances)

- **Provides:** the real walking distance + duration for each (station, POI) pair where the POI sits inside that station's 15-min isochrone — the "Nearest stations" rows in a POI popup.
- **Endpoint:** `api.mapbox.com/directions-matrix/v1/mapbox/walking`. Needs `MAPBOX_TOKEN`. Caches per pair, so a refresh is incremental.
- **Raw dump:** `data/pois/raw/walking-distances.json.gz`. The offline POI build attaches a sorted `stations[]` array to each POI from this dump; POIs outside every walkshed simply lack the array. A straight-line fallback keeps membership non-empty ([INV-001](../invariants.md)).

### OpenStreetMap — station entrances (Overpass)

- **Provides:** `railway=subway_entrance` / `railway=train_station_entrance` nodes for the floating "EXIT" badges.
- **Endpoint:** `overpass-api.de/api/interpreter` (separate query + dump from POIs).
- **Raw dump:** `data/pois/raw/station-exits.json.gz`.
- **Build:** `fetch_station_exits.py` assigns each entrance to its nearest Link station (within the build cutoff), precomputes `bearingFromStation`, and writes `public/station-exits.geojson`. Coverage is partial (~33/38 stations). See [Station exits](station-exits.md).

## Outputs in `public/`

Everything the runtime fetches:

| Output | Format | Produced by | Consumed by | Guards |
| --- | --- | --- | --- | --- |
| `line1-alignment.geojson`, `line2-alignment.geojson` | GeoJSON LineString | `process.py` | route rendering | — |
| `all-stations.geojson` | GeoJSON Point ×38 | `process.py` | pills, routing, deep links | [INV-012](../invariants.md) |
| `pois/tiles/{col}_{row}.geojson` + `index.json` | GeoJSON grid + JSON | `build_refined.py` | per-walkshed POI streaming | [INV-019](../invariants.md), [INV-020](../invariants.md) |
| `pois/tag-categories.json` | JSON | `build_refined.py` | chip coloring + legend | [INV-006](../invariants.md), [INV-017](../invariants.md) |
| `station-exits.geojson` | GeoJSON Point | `fetch_station_exits.py` | exit badges | [INV-021](../invariants.md), [INV-022](../invariants.md) |

The full ~26k-POI dataset (every tag, every marginal place) is preserved across the tile grid even though the runtime only ever loads the ~11 tiles overlapping the active walkshed. See [Refined POIs](refined-pois.md).

## Key feature schemas

Property shapes worth knowing when reading or extending the pipeline.

**POI feature** (`pois/tiles/*.geojson`):

```json
{
  "id": "node/123",              // OSM node/way id (int kept for Matrix join)
  "name": "…",                   // non-empty (INV-002)
  "category": "coffee",          // in VALID_CATEGORIES (INV-002)
  "tags": ["coffee", "vegan"],   // non-empty; every tag in tag-categories (INV-006)
  "sources": ["osm", "overture"],// provenance ⊆ {osm, overture} (INV-008)
  "address": "…", "website": "…", "phone": "…", "hours": "…",
  "stations": [                  // sorted asc by walkingSeconds (INV-007)
    { "stopCode": 50, "lines": "1,2", "name": "Westlake",
      "walkingMeters": 210, "walkingSeconds": 168, "band": 5 }
  ]
}
```

**Station feature** (`all-stations.geojson`): integer `stopCode`, `lines ∈ {"1","2","1,2"}`, `name`, plus a `shared` flag ([INV-012](../invariants.md)).

**Exit feature** (`station-exits.geojson`): unique `id`, `stationKey` (`{lines}-{stopCode}`), `stationName`, `name`, `bearingFromStation ∈ [0,360)`, optional `accessible`, `source ⊆ {osm}` ([INV-021](../invariants.md)).

## Attribution & licensing

The site footer and `mkdocs.yml` credit **Sound Transit, SDOT, OpenStreetMap, and Overture Maps**. Obligations to keep in mind when redistributing:

- **OpenStreetMap** data is licensed under the **ODbL** — attribution and share-alike apply to derived data.
- **Overture Maps** aggregates OSM and other sources under a mix of **ODbL** and **CDLA-Permissive-2.0**; carry the Overture attribution.
- **Sound Transit / SDOT** feeds are public agency data.
- **Mapbox** Isochrone/Matrix results are derived under the Mapbox terms of service — treat them as ephemeral routing output, not a redistributable dataset.

## Credentials & environment

Only the Mapbox refresh paths need a secret:

- `MAPBOX_TOKEN` (or `MAPBOX_ACCESS_TOKEN`) — required by `fetch_walksheds.py --refresh` and `fetch_walking_distances.py --refresh`. Public (`pk.`) and secret (`sk.`) tokens have identical capability for these read endpoints; the practical constraint is URL restriction, since a browser-restricted token fails the referrer check from a script.
- The browser bundle uses a separate origin-restricted `VITE_MAPBOX_ACCESS_TOKEN`.

Overpass, ArcGIS, and Overture S3 need no credentials. See [Commands](../commands.md) for the exact refresh invocations and [Deployment](../deployment.md) for how tokens are provisioned in CI.
