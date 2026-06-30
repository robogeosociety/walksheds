# Contributing

Common changes, with the guardrails that apply to each. The repository is the source of truth; when in doubt, read `CLAUDE.md` and the relevant build script.

## Add a POI category

1. Edit `CATEGORIES` in `data/pois/fetch_pois.py`. The `osm_key` must already be in `RAW_KEYS`.
2. Run `python3 data/pois/fetch_pois.py` (no network — rebuilds from the committed dump).
3. Wire the category into `src/constants.js`.
4. Only if the category needs an OSM tag key the dump doesn't cover: add it to `RAW_KEYS` and run `fetch_pois.py --refresh`.

See [POIs](data/pois.md) for the tag-extraction config tables (`BOOL_TAG_FIELDS`, `MULTI_VALUE_FIELDS`, `VALUE_AS_TAG_FIELDS`, `TAG_ALIASES`).

## Expose a new tag

Tag extraction is config-driven — usually no code change. Add a row to the relevant table in `extract_tags` and rebuild. Every tag must resolve to a category in `tag-categories.json` ([INV-006](invariants.md)), so also place it in `EXPLICIT_TAG_CATEGORIES` if it shouldn't fall through to the default `cuisine` bucket.

## Add an invariant

!!! warning "Append-only"
    Never renumber or reuse an `INV` number.

1. Append the next number (the catalog is at INV-022 — yours is INV-023).
2. Add a test: `data/pois/test_invariants.py` for data, `src/__tests__/invariants.test.js` for frontend, or an inline build check.
3. Document it in [Core invariants](invariants.md) and in `CLAUDE.md`.

## Change UI

Default to the transit-cartography idiom and reuse the existing station-pill / line-color vocabulary rather than inventing ornament. Control icons are inline SVG on a shared spec (`viewBox 0 0 16 16`, `currentColor`, round joins). See [Design system](design-system.md).

!!! danger "No emoji ([INV-018](invariants.md))"
    Not in the UI, popups, labels, docs, this wiki, commit messages, or PR descriptions. Use real iconography or typographic marks.

## Run the checks

```bash
npm run lint
npm run test -- --run
npm run e2e
python3 -m pytest data/
```

See [Commands](commands.md) for the full list.

## Pull requests

PR descriptions follow the **newspaper / information-pyramid** format — one self-contained front page that reads top to bottom: kicker, headline, dek, masthead, why, what, a mermaid flow, screens, verification, risk. Rebuild from the full diff rather than appending. CI validates the body via the `pr-newspaper` workflow. The full rules live in [`PR_FRAMEWORK.md`](https://github.com/tommyroar/.github/blob/main/PR_FRAMEWORK.md).
