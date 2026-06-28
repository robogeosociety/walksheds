# POI feedback queue

The POI popup carries a **Report a problem** control (`src/POIPopupCard.jsx`,
`src/poiFeedback.js`). Because the site is a static GitHub Pages SPA with no
backend, a report can't be POSTed anywhere — instead the button opens a
**prefilled GitHub issue** in a new tab, labeled `poi-feedback`, with the
listing's identity baked into the body. The label is the queue: reports
accumulate as open issues for an agent to batch-process.

Manually filed reports use the same shape via the issue form at
`.github/ISSUE_TEMPLATE/poi-feedback.yml`.

## Issue body shape

App-filed issues contain a stable `key: value` block (parse this, don't scrape prose):

```
Reason: closed | duplicate | inaccurate
POI ID: <osm id or overture gers id>
Name: <listing name>
Category: <category>
Sources: osm, overture          # which upstream(s) the listing came from
Coordinates: <lat>, <lng>
Nearest station: <name> (stopCode <n>, lines <1|2|1,2>)
```

## Batch triage (for an agent)

1. **Collect** — list open issues labeled `poi-feedback`
   (`mcp__github__list_issues` with `labels: ["poi-feedback"]`, or `search_issues`).
2. **Parse** — extract the `key: value` block from each body; group by `Reason`.
3. **Apply fixes:**
   - **closed / duplicate, OSM-sourced** (`Sources` includes `osm`, numeric POI ID):
     add the OSM id to `DENY_OSM_IDS` in `data/pois/fetch_pois.py`. This is honored
     by the production tile build too — `build_refined.py` imports `build_category`,
     which calls `is_closed_or_denied` (see `data/pois/fetch_pois.py:700`). For a
     **duplicate**, deny the lower-quality of the pair (keep the one with richer
     contact/tag data).
   - **Overture-only POIs** (string/GERS id, `Sources` is `overture` only): **not
     covered by `DENY_OSM_IDS`.** There is no Overture exclusion mechanism yet —
     flag these for the maintainer rather than guessing. (A future `DENY_GERS_IDS`
     set filtered inside `build_refined.py` would close this gap.)
   - **inaccurate**: prefer fixing upstream in OpenStreetMap so the next `--refresh`
     picks it up; otherwise note for a future field-override mechanism.
4. **Rebuild + ship** — `python3 data/pois/build_refined.py` regenerates the tiles
   (needs network for the Overture S3 query). Commit the changed tiles +
   `data/pois/fetch_pois.py`, push; `deploy.yml` publishes to GitHub Pages. The
   data-invariants CI job re-verifies INV-019 (tile coverage) and INV-020
   (station→tile lookup) after the rebuild.
5. **Close** — close each processed issue, referencing the commit that fixed it.

## One-time setup

The `poi-feedback` label must exist in the repo for the `?labels=poi-feedback`
query param (and the issue form's `labels:`) to stick. Create it once via the
GitHub UI or API.
