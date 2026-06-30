# walksheds-wiki

Source for the **Walksheds Guide** at [wiki.walksheds.xyz](https://wiki.walksheds.xyz) — a plain-language, reader-facing companion to [Walksheds](https://walksheds.xyz). It explains what a walkshed is, how to use the map, what each Link station is near, and the story of Seattle's light rail system.

The developer-facing engineering manual is a separate site: the codex at [dev.wiki.walksheds.xyz](https://dev.wiki.walksheds.xyz) (source under `dev-wiki/` in the main repo).

Built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/). Tone and structure are modeled on the urbanism-guide style — plain language, "why it matters" framing, a timeline, a glossary — but it's a standalone MkDocs site, not a fork of any module.

## Layout

Authored under `wiki/` in the [`tommyroar/walksheds`](https://github.com/tommyroar/walksheds) repo for review, and published from the standalone `tommyroar/walksheds-wiki` repo. GitHub Pages allows only one custom domain per repo, so the guide needs its own repo to get its own subdomain.

```
mkdocs.yml                  site config, nav, theme (Link palette, 2 Line blue)
requirements.txt            mkdocs-material + pymdown-extensions
.github/workflows/deploy.yml  build + GitHub Pages deploy (root-only; inert under wiki/)
docs/
  index.md                  welcome
  walkability.md            what a walkshed is, why it matters (+ folded-in glossary)
  using-the-app.md          how to read the map
  link-guide/               per line: an overview + a station-openings view, plus future-line stubs
    index.md                system overview
    line-1.md, line-2.md    line overviews
    line-1-openings.md      station-opening views (the "history", per line)
    line-2-openings.md
    future.md               future lines overview
    future-*.md             stub articles (West Seattle, Ballard, Tacoma, Everett, Issaquah)
  assets/img/               live-app screenshots embedded across the guide
  CNAME                     wiki.walksheds.xyz (copied into site/ on build)
  stylesheets/extra.css     the Link palette, roundels, timeline, stat cards
```

## Local development

```bash
pip install -r requirements.txt   # or: uv pip install -r requirements.txt
mkdocs serve                      # http://127.0.0.1:8000
mkdocs build --strict             # what CI runs; fails on broken links/nav
```

No emoji, sentence case, transit-cartography house style — same rules as the app.
