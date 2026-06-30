# walksheds-dev-wiki

Source for the **Walksheds Codex** at [dev.wiki.walksheds.xyz](https://dev.wiki.walksheds.xyz) — the long-form engineering manual for [Walksheds](https://walksheds.xyz).

This is the developer-facing site. The reader-facing companion — a plain-language guide to walksheds and Seattle Link — lives at [wiki.walksheds.xyz](https://wiki.walksheds.xyz) (source under `wiki/` in the main repo).

Built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/).

## Layout

This directory is authored under `dev-wiki/` in the [`tommyroar/walksheds`](https://github.com/tommyroar/walksheds) repo for review, and published from the standalone `tommyroar/walksheds-dev-wiki` repo. GitHub Pages allows only one custom domain per repo, so the codex needs its own repo to get its own subdomain. See `docs/deployment.md`.

```
mkdocs.yml                  site config, nav, theme (Link palette)
requirements.txt            mkdocs-material + pymdown-extensions
.github/workflows/deploy.yml  build + GitHub Pages deploy (root-only; inert under dev-wiki/)
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
  CNAME                     dev.wiki.walksheds.xyz (copied into site/ on build)
  stylesheets/extra.css     the Sound Transit Link palette
```

## Local development

```bash
pip install -r requirements.txt   # or: uv pip install -r requirements.txt
mkdocs serve                      # http://127.0.0.1:8000
mkdocs build --strict             # what CI runs; fails on broken links/nav
```

## Deploy

Pushing to `main` of the standalone repo runs `.github/workflows/deploy.yml`, which builds with `mkdocs build --strict` and deploys to GitHub Pages. The `dev.wiki` CNAME record (Cloudflare, managed in the main repo's `infra/`) points the subdomain at GitHub Pages.

No emoji, sentence case, transit-cartography house style — same rules as the app.
