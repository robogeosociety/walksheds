# The Honolulu preview

Honolulu's data is complete and passes every per-city invariant, but it has not
had a human review pass yet. So it is marked `preview=True` in `data/cities.py`,
which keeps it out of the public site entirely, and it is reviewed **locally**.

There is deliberately no hosted preview and no Cloudflare Access door — see
"Why not a hosted gate" below.

## Reviewing it

```bash
VITE_PREVIEW_CITIES=1 npm run dev      # then pick Honolulu in the legend
VITE_PREVIEW_CITIES=1 npm run build    # or build the full preview bundle
```

Without that flag — which means every normal build, including the
`walksheds.xyz` deploy — the city is absent. Worth knowing exactly how absent,
because "the UI hides it" would not have been enough:

- The Vite plugin in `vite.config.js` rewrites the city registry the bundle
  imports, so the public JS carries no trace of the city: not its name, not its
  map centre, not its line color.
- It also deletes `dist/cities/honolulu/` after the build, because Vite copies
  `publicDir` wholesale and would otherwise publish the city's stations, tiles
  and isochrones at a guessable path even with the UI hiding it.

Both halves live in one module, `src/previewCities.js`, so the rule can't drift
apart. `src/__tests__/previewCities.test.js` covers it, including that a public
registry never keeps a `defaultCity` pointing at a city that was just removed.

Verify the split any time:

```bash
npm run build                        # dist/cities/ -> seattle only
VITE_PREVIEW_CITIES=1 npm run build  # dist/cities/ -> honolulu, seattle
grep -c honolulu dist/assets/*.js    # 0 for a public build
```

## Launching it

1. Set `preview=False` on `HONOLULU` in `data/cities.py`.
2. `python3 data/cities.py` to regenerate `src/cityRegistry.json` (INV-024).
3. The next `walksheds.xyz` deploy includes it, and the legend's city switcher
   offers it alongside Seattle.

Nothing else to undo — there is no infrastructure standing behind the flag.

## Why not a hosted gate

A gated `honolulu.walksheds.xyz` was scoped and then dropped, for reasons worth
recording so it isn't reflexively revived:

- It would have added a Cloudflare Access application in the same week that
  `robogeosociety/robot-geographical-society#187` is **deleting** the `dev` and
  `wiki` Access apps, moving the org to GitHub Free and cancelling Workers Paid.
- `walksheds.xyz` sits in the `tommyroar-dev` Cloudflare account, which has **no
  Zero Trust organization and no identity providers** at all. The GitHub IdP that
  #187 keeps lives in a different account, so a GitHub-gated door here meant
  either a second Zero Trust org or moving the zone.
- The Access-scoped API token would have come from `/tf-vend`, which runs against
  local state on the Mac mini — unreachable while `/Volumes/dev` is wedged.

Local review costs none of that and the flag is the part that actually matters:
it is what keeps an unreviewed dataset off the public site.

## Appendix: the hosted preview, if it is ever wanted

`infra/preview.tf` and `infra/preview-repo/deploy.yml` are committed but **not
applied and not wired to anything**. `enable_preview_gate` defaults to `false`,
and it deliberately controls the DNS record *and* the Access resources together
so a hostname can never resolve before its door exists.

If a hosted preview is ever needed, the prerequisites are the three bullets
above, and the bring-up order is door before content:

```bash
# 1. Second Pages site (one custom domain per repo, same reason wiki.walksheds.xyz
#    lives in walksheds-wiki). Add infra/preview-repo/deploy.yml as its
#    .github/workflows/deploy.yml, set Pages source to "GitHub Actions", and set
#    the custom domain to honolulu.walksheds.xyz.
gh repo create robogeosociety/walksheds-honolulu --public

# 2. Record + door together.
cd infra && tofu apply -var enable_preview_gate=true

# 3. Publish.
gh workflow run 'Deploy Honolulu preview' --repo robogeosociety/walksheds-honolulu
```

One detail that makes that a real gate rather than decoration: GitHub Pages
stops serving a site's content at `<user>.github.io/<repo>/` once a custom domain
is attached — verified, `tommyroar.github.io/walksheds/` 404s today — so the
proxied custom hostname is the only route to it. The corollary is a config-drift
risk rather than an open door: detach the custom domain and the `github.io` path
starts serving.
