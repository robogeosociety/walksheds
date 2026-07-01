# Walksheds codex (the /dev subpage)

Source for the **Walksheds Codex** at [wiki.walksheds.xyz/dev](https://wiki.walksheds.xyz/dev/) — the long-form engineering manual for [Walksheds](https://walksheds.xyz).

This is the developer-facing site. The reader-facing companion — a plain-language guide to walksheds and Seattle Link — is the parent site at [wiki.walksheds.xyz](https://wiki.walksheds.xyz) (source under `wiki/` in the main repo).

Built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/).

## Layout

The codex is its own MkDocs project nested at `wiki/codex/`. It is **not** deployed on its own — the reader guide's deploy workflow (`wiki/.github/workflows/deploy.yml`) builds the guide to `site/` and then builds this codex into `site/dev/`, so the whole thing ships as one GitHub Pages site served at `wiki.walksheds.xyz` (guide) and `wiki.walksheds.xyz/dev/` (codex). No separate repo, no separate subdomain, no separate `CNAME`. See `docs/deployment.md`.

```
mkdocs.yml                  codex site config (site_url .../dev/), nav, theme (Link palette, 1 Line green)
docs/
  index.md                  home
  architecture.md
  design-system.md
  data/                     the five-source pipeline
  invariants.md             INV-001..022
  commands.md
  deployment.md
  station-codes.md
  contributing.md
  glossary.md
  stylesheets/extra.css     the Sound Transit Link palette
```

## Local development

From `wiki/codex/`:

```bash
pip install -r ../requirements.txt   # shares the guide's deps
mkdocs serve                         # http://127.0.0.1:8000 (preview in isolation)
mkdocs build --strict                # what CI runs; fails on broken links/nav
```

To preview exactly as deployed (codex under `/dev/`), build both from `wiki/`:

```bash
mkdocs build -d site && mkdocs build -f codex/mkdocs.yml -d "$PWD/site/dev"
```

No emoji, sentence case, transit-cartography house style — same rules as the app.
