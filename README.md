# walksheds
Points of interest within walking distance of a Seattle light rail station

[![Reader guide](https://img.shields.io/badge/docs-reader%20guide-38B030)](https://wiki.walksheds.xyz/)
[![Engineering codex](https://img.shields.io/badge/docs-engineering%20codex-00A0E0)](https://wiki.walksheds.xyz/dev/)
[![Live site](https://img.shields.io/badge/live-walksheds.xyz-2b2f36)](https://walksheds.xyz)

# Objectives
1. A clickable and scrollable map of Seattle light rail stations that displays dynamic walksheds (circles reachable within a given time walking from the station)
2. These walksheds will include a sortable and filtered list of attractions (restaurants, shops, concert venues &c) within this walking range
3. Attraction data relies as much as possible on existing open-source and user-provided location data
4. **Walkshed–station listing invariant (`INV-001`):** every POI that falls inside a station's 15-minute walkshed must list at least one nearby station (a non-empty "Stations within a 15 min walk" section). Walkshed membership ⇒ a non-empty nearby-stations list — no POI is ever shown inside a walkshed with nothing to walk to. Enforced at build time by `verify_walkshed_invariant` in `data/pois/build_refined.py`. See `CLAUDE.md` → "Core Invariants" for the full `INV-NNN` list.

## Documentation

Two companion sites, both published to the `walksheds-wiki` GitHub Pages repo (source in `wiki/`):

- **Reader guide** — <https://wiki.walksheds.xyz/> — a plain-language guide to walksheds, walkability, and riding Seattle Link: how to use the map, what each station is near, and the history of the system. Reachable in-app from the open-book icon in the map legend.
- **Engineering codex** — <https://wiki.walksheds.xyz/dev/> — the developer manual: architecture, the data pipelines (transit, POIs, walksheds, station exits), every `INV-NNN` invariant, the design system, commands, and deployment. Source in `wiki/codex/`.

`CLAUDE.md` remains the canonical short-form reference for the house rules and the full `INV-NNN` invariant list.

## Embedding

Walksheds can be dropped into any page or dashboard as an iframe with `?embed=1`, a URL-param config API, and a two-way `postMessage` bridge. See the live demo + snippet generator at <https://walksheds.xyz/embed.html>, the helper at `public/embed.js`, and the full reference in the [codex embedding guide](https://wiki.walksheds.xyz/dev/embedding/).

## POI selection logic

Three independent inputs decide which POIs are visible inside a walkshed:

- **Spotlights** — curated category pills always visible at the top
  (`restaurants`, `bars`, `coffee`, `parks`, `everything`). Defined in
  `src/constants.js` under `MAIN_POI_CATEGORY_DEFS`. The `everything`
  spotlight carries a `matchAll: true` flag that short-circuits the
  category pool to every POI in the walkshed.
- **Active categories** — user-added POI-type tags (`pizza`, `museum`,
  `cannabis`, …). Added via the search box, shown as pills next to the
  spotlights.
- **Active filters** — cross-cutting attribute tags
  (`child-friendly`, `wheelchair-accessible`, `vegan`, `wifi`, …). Membership
  is fixed at build time as the union of the `service`, `diet`,
  `accessibility`, `family`, and `vibe` tag-category buckets in
  `data/pois/fetch_pois.py` (published in `tag-categories.json` as
  `filter_tag_categories`). Shown as a vertical checkbox list below the pills.

Selection is a union of POI types (spotlights ∪ active categories) intersected
with an AND of all active filters:

```
pool = matchAll ? all
     : { f | f matches any enabled spotlight } ∪ { f | f has any active category tag }
visible = pool ∩ { f | f has every active filter tag }
```

Truth table (rows enumerate which inputs are non-empty; `matchAll` is its
own column because the `everything` spotlight is special):

| Spotlights | matchAll? | activeCategories | activeFilters | Visible POIs                                    |
| ---------- | --------- | ---------------- | ------------- | ----------------------------------------------- |
| ∅          | —         | ∅                | ∅             | none (empty pill bar ⇒ empty map)               |
| ∅          | —         | ∅                | non-∅         | none (no pool to filter)                        |
| ∅          | —         | non-∅            | ∅             | POIs tagged with any active category            |
| ∅          | —         | non-∅            | non-∅         | (category match) ∩ (has every filter)           |
| non-∅      | no        | ∅                | ∅             | union of spotlight matches                      |
| non-∅      | no        | ∅                | non-∅         | (spotlight match) ∩ (has every filter)          |
| non-∅      | no        | non-∅            | ∅             | (spotlight match) ∪ (category match)            |
| non-∅      | no        | non-∅            | non-∅         | ((spotlight) ∪ (category)) ∩ (has every filter) |
| non-∅      | yes       | (any)            | ∅             | all POIs in the walkshed                        |
| non-∅      | yes       | (any)            | non-∅         | all POIs ∩ (has every filter)                   |

Categories are additive (union: more pills = more dots); filters are
restrictive (intersection: more checkboxes = fewer dots).

Implementation: `filterByCategoriesAndFilters` in `src/poiUtils.js`.
State lives in `src/Walksheds.jsx` as `enabledSpotlights`, `activeCategories`,
and `activeFilters`. URL persistence (`src/poiFilterUrl.js`) carries both
category and filter tags in a single tag namespace; the frontend routes each
parsed tag back to the right state set via its bucket in `tag_to_category`.
