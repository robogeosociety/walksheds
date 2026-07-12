# Site feedback queue

The legend carries a **feedback** control (`src/LineLegend.jsx`,
`src/siteFeedback.js`) for general feedback about the site itself — a UI bug, a
suggestion, or anything not tied to a specific POI (for those, see
[POI feedback](./poi-feedback.md)). It's a single speech-bubble icon button
inline with the other legend toggles (dark / units / help / guide); clicking it
expands the reason categories (`bug` / `idea` / `other`) as a small popover — a
deliberate extra step before a report is filed. Because the site is a static
GitHub Pages SPA with no backend, a report can't be POSTed anywhere — instead
each category opens a **prefilled GitHub issue** in a new tab, labeled
`site-feedback`, with the reason and the current page context baked into the
body. The label is the queue: reports accumulate as open issues for an agent to
triage.

Manually filed reports use the same shape via the issue form at
`.github/ISSUE_TEMPLATE/site-feedback.yml`.

## Issue body shape

App-filed issues contain a stable `key: value` block (parse this, don't scrape prose):

```
Reason: bug | idea | other
Page: <url the reporter was on>
Viewport: <width>x<height>
User agent: <browser UA string>
```

Only `Reason` is always present; the context lines appear when the browser
supplied them.

## Triage (for an agent)

1. **Collect** — list open issues labeled `site-feedback`
   (`list_issues` with `labels: ["site-feedback"]`, or `search_issues`).
2. **Parse** — extract the `key: value` block from each body; group by `Reason`.
3. **Act:**
   - **bug** — reproduce from `Page` + `Viewport` + `User agent`; open a fix PR.
   - **idea** — evaluate; convert to a tracked enhancement or close with a note.
   - **other** — route to the maintainer.
4. **Close** — close each processed issue, referencing the commit/PR that
   addressed it.

## One-time setup

The `site-feedback` label must exist in the repo for the
`?labels=site-feedback` query param (and the issue form's `labels:`) to stick.
Create it once via the GitHub UI or API.
