# POI Data Source Proposal — Replacing the OSM/Overpass Pipeline

**Status:** Draft for review · **Date:** 2026-05-30 · **Author:** generated for Tommy

## 1. The problem

The current POI layer is built offline from an OpenStreetMap Overpass dump
(`data/pois/raw/osm-seattle.json.gz`) and committed as static GeoJSON in
`public/pois/` (10,457 features across 8 categories). OSM's weakness for this use
case is **business-listing quality**: spotty coverage of real shops/restaurants,
stale or already-closed businesses, and inconsistent tagging (the pipeline already
carries a hand-maintained deny-list and closure-regex to paper over this). For a
consumer-facing "what's near this station" explorer, that completeness/freshness
gap is the core complaint.

## 2. What the pipeline actually requires

Any replacement has to feed the same downstream contract. From
`fetch_pois.py` + the frontend (`poiUtils.js`, `constants.js`, `Walksheds.jsx`):

| Need | Detail |
|---|---|
| **Geographic scope** | One fixed bbox: S 47.303, W −122.351, N 47.830, E −122.104 (38 Link stations, ~53 km × 25 km) |
| **Volume** | ~10k named POIs in that bbox |
| **8 categories** | restaurants, shops, parks, attractions, fitness, services, healthcare, lodging (mapped from OSM `amenity`/`tourism`/`leisure`/`shop`) |
| **Per-feature fields used by UI** | `name` (required), `category`, `tags[]`, and optional `address`, `website`, `phone`, **`hours`** |
| **Tag richness** | ~362 canonical tags drive chips/filters — cuisine, diet, service style, drinks, sport, star ratings. This is OSM-tag-specific and the most source-sensitive part |
| **Closure signal** | a way to drop defunct businesses |
| **Architecture** | **batch build → commit static GeoJSON → serve from GitHub Pages.** No per-user API calls today. |

That last row is the decisive constraint. See §3.

## 3. The licensing fork in the road (read this first)

The current design is **store-and-redistribute**: data is baked into the repo and
served as static files to every visitor. Commercial POI APIs forbid exactly that.

- **Google Maps Platform** — Terms prohibit pre-fetching, caching, or storing
  Places content beyond `place_id` (a few narrow 30-day exceptions). You **cannot**
  commit Google place data to `public/pois/` and serve it. Going Google means
  re-architecting to **live, per-user API calls** with nothing stored.
- **Mapbox Search** — same shape: results may not be stored unless you pay for
  *permanent* geocoding, and its POI corpus is weaker for category browsing anyway.
- **Foursquare OS Places** (Apache-2.0) and **Overture Maps** (CDLA Permissive) —
  open bulk datasets explicitly licensed for redistribution. These **keep the
  current static architecture intact** and are free.

So the real choice isn't "which API is cheapest" — it's **"swap one open bulk
dataset for a better open bulk dataset (free, no re-architecture)"** vs. **"adopt a
metered live API (recurring cost + rewrite + storage ban)."**

## 4. Options evaluated

### A. Overture Maps Places — *recommended primary*
- 64M+ global POIs; GeoParquet on S3/Azure; monthly releases.
- Fields: `names`, `categories` (primary + alternate) + `confidence` (0–1),
  `websites`, `socials`, `emails`, `phones`, `brand`, `addresses`,
  `operating_status` (open / temporary hiatus / closed). **No opening hours.**
- Built by fusing Meta + Microsoft + foursquare + others → materially better
  business coverage and a real **confidence score** to filter junk and a closure
  signal that replaces the regex hack.
- License (CDLA Permissive) allows committing to the repo and static serving.
- **Cost: $0.**

### B. Foursquare OS Places — *recommended secondary / cross-check*
- 100M+ POIs; Parquet on S3 / Hugging Face / Snowflake; monthly updates.
- Fields: `name`, lat/lon, `fsq_category_labels`, full address parts, `website`,
  `tel`, `email`, social handles, `date_closed`, `date_refreshed`. **No hours.**
- Apache-2.0 → redistributable. Largely the same lineage Overture draws from;
  useful to fill gaps / cross-validate names + categories.
- **Cost: $0.**

### C. Google Places API (New) — *best data, wrong shape for us*
- Richest attributes incl. **opening hours, ratings, photos** — the one thing
  open data lacks.
- But: no storage allowed → must call live per user; category browsing of ~10k
  POIs would need repeated Nearby/Text Search calls (expensive, see §5). Realistic
  role is **on-demand enrichment only** (hours/rating when a user opens one POI).

### D. Mapbox Search Box — *poor fit*
- Aug-2025 reprice moved to per-keystroke/session billing ($3–11.50/1k sessions);
  category corpus thinner than Google; storage requires permanent-geocoding tier.
  No advantage here over open data + optional Google enrichment.

### E. Foursquare Premium / HERE / TomTom — paid commercial bulk licenses with
  hours included; overkill for a free hobby SPA. Listed for completeness only.

## 5. Cost tiers

### Recommended path (Overture/Foursquare open data) — flat $0

| Usage tier | Visitors/mo | Data cost | Notes |
|---|---|---|---|
| Hobby | < 5k | **$0** | identical to today: static GeoJSON on Pages |
| Growing | 5k–50k | **$0** | " |
| Popular | 50k–500k+ | **$0** | " (Pages bandwidth only) |

Only recurring "cost" is the monthly rebuild (a script run), same as today.

### Optional Google enrichment (hours/ratings on POI click only)

Live `Place Details` call when a user opens a single POI. Nothing stored. Billed
per call after the free cap. Two field tiers:

- **Pro** (adds opening hours): free 5k/mo, then **$17 / 1k** (0–100k band),
  $13.60 / 1k (100k–500k).
- **Enterprise + Atmosphere** (hours + rating + photos): free 1k/mo, then
  **$25 / 1k** (0–100k), $20 / 1k (100k–500k).

| Detail-calls/mo | Pro (hours) | Ent+Atmosphere (hours+ratings) |
|---|---|---|
| 5,000 | **$0** (within free cap) | ~$100 |
| 25,000 | ~$340 | ~$600 |
| 100,000 | ~$1,683 | ~$2,475 |
| 500,000 | ~$7,120 | ~$10,475 |

> Rule of thumb: budget = (detail-calls − free cap) × rate. Add client-side
> rate-limiting/debounce so idle hovering doesn't bill.

### Full Google replacement (not recommended)

Browsing 10k POIs live means Nearby/Text Search (**$32 / 1k**, free cap 5k) on
every pan/filter — easily 6–7 figures of calls/month at modest traffic, *plus*
the storage ban kills the static-Pages model. Don't.

## 5b. Prototype results (Overture, run 2026-05-30)

`fetch_overture.py` pulls the Overture `places` theme (release `2026-04-15.0`)
via DuckDB-over-S3, clipped to the exact station bbox — no full download, query
ran in seconds. It maps Overture's taxonomy onto the 8 Walksheds buckets and
emits byte-compatible GeoJSON (reusing `fetch_pois.py`'s tag plumbing). Findings
vs. the committed OSM data:

| Metric | OSM (committed) | Overture (bbox) |
|---|---|---|
| **Total named POIs** | 12,457 (sum across category files) | **90,702** |
| **Dining-category POIs** | 5,303 (`restaurants.geojson`) | **9,960** |
| **Have website** | small minority¹ | **92%** (83,467) |
| **Have phone** | small minority¹ | **93%** (84,679) |
| **Have address** | small minority¹ | **98%** (89,107) |
| **Quality signal** | none (regex/deny-list) | `confidence` 0–1 (median 0.77) |

¹ OSM contact tags are sparsely populated; Overture's are near-complete.

Confidence thresholding leaves plenty of headroom: ≥0.5 keeps 73,730 places,
≥0.7 keeps 67,671 — still ~6× the OSM corpus. **Cuisine is baked into the primary
category** (`mexican_restaurant`, `pizza_restaurant`, `coffee_shop`…), so the
cuisine-tag vocabulary can be derived directly instead of inferred from fragile
OSM `cuisine=` tags.

A full run (confidence ≥ 0.5) produces **19,433 features** across the 8 buckets
(restaurants 8,904 · shops 4,080 · attractions 1,778 · parks 1,172 · fitness
1,043 · services 970 · healthcare 937 · lodging 549) — vs OSM's 12,457. Output
passes the existing `--validate-only` checks, all 105 JS unit tests, lint, and
the production build. The 54k dropped places are correctly out-of-scope
categories the OSM pipeline also excludes (real-estate agents, doctors, salons,
schools, auto repair).

**Takeaway:** Overture roughly doubles dining coverage even filtered to dining
categories, ~1.6×'s total in-scope coverage, and ships the contact metadata OSM
mostly lacks — at $0 and with no architecture change. Hours remain the only gap
(§6).

> Reproduce: `python3 data/pois/fetch_overture.py` (needs `duckdb`, `pandas`,
> `pyarrow`). `--dry-run` to preview, `--min-confidence` to tune the quality gate.

## 6. Recommendation

1. **Replace the OSM source with Overture Places** as the primary bulk feed,
   keeping the exact build-and-commit architecture. Use `confidence` to threshold
   quality and `operating_status` to drop closures (retire the deny-list/regex).
2. **Cross-reference Foursquare OS Places** to fill names/categories Overture
   misses. Both free, both redistributable.
3. **Map their category taxonomies → the existing 8 categories + tag vocabulary.**
   This is the bulk of the work: Overture/FSQ categories are cleaner but differently
   shaped than OSM tags, so `EXPLICIT_TAG_CATEGORIES`, `TAG_ALIASES`, and
   `extract_tags` need a new adapter. The downstream frontend stays untouched.
4. **Hours gap:** open data has no opening hours. Either (a) accept dropping the
   `hours` field, or (b) add **optional live Google `Place Details` (Pro)
   enrichment on POI-click only** — ToS-compliant (no storage), and within/near the
   free tier at hobby traffic. Recommend shipping (a) first, adding (b) only if
   users ask for hours.

## 7. Migration sketch

- `data/pois/fetch_overture.py`: pull the Overture `places` theme clipped to the
  station bbox (DuckDB spatial over the S3 GeoParquet — no full download).
- New `map_categories.py`: Overture/FSQ taxonomy → existing 8 categories + tags;
  rebuild `tag-categories.json`.
- Keep output schema byte-compatible (`id`/`name`/`category`/`tags[]` + optional
  `address`/`website`/`phone`[/`hours`]) so `Walksheds.jsx` needs zero changes.
- Run both old (OSM) and new (Overture) builds, diff feature counts per category +
  spot-check known closed/missing businesses to confirm the quality win before
  switching `RAW_KEYS`/pipeline over.

## Sources

- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) · [Places caching/redistribution policy](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Foursquare OS Places](https://opensource.foursquare.com/os-places/) · [schema](https://docs.foursquare.com/data-products/docs/places-os-data-schema) · [Apache-2.0 dataset](https://huggingface.co/datasets/foursquare/fsq-os-places)
- [Overture Maps places guide](https://docs.overturemaps.org/guides/places/) · [place schema](https://docs.overturemaps.org/schema/reference/places/place/)
- [Mapbox Search JS pricing](https://docs.mapbox.com/mapbox-search-js/guides/pricing/)
