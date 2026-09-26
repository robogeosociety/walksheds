# The gated Honolulu preview

Honolulu ships behind a door while its dataset is reviewed. The public site at
`walksheds.xyz` does not mention it and does not serve its data; the reviewable
build lives at `honolulu.walksheds.xyz` behind Cloudflare Access.

## How the gate works

Three independent layers, because any one alone leaks:

1. **The public build strips the city.** `data/cities.py` marks Honolulu
   `preview=True`. A build without `VITE_PREVIEW_CITIES=1` (i.e. every normal
   build, including the `walksheds.xyz` deploy) rewrites the registry the bundle
   imports so the city is absent — not even its name or map centre ships — and
   deletes `dist/cities/honolulu/` so its stations, tiles and isochrones are not
   published at a guessable path. The rule lives in `src/previewCities.js`,
   applied by the Vite plugin in `vite.config.js`.

2. **The preview has its own hostname.** GitHub Pages allows one custom domain
   per repo, so the preview is a second Pages site
   (`robogeosociety/walksheds-honolulu`) whose workflow builds *this* repo with
   the flag on. That workflow is ready to copy at
   `infra/preview-repo/deploy.yml`.

3. **Cloudflare Access fronts that hostname.** `infra/preview.tf` creates the
   proxied `honolulu` CNAME and an Access application + policy over it.

Layer 3 is a real gate rather than decoration because of a GitHub Pages
behaviour worth stating explicitly: once a site has a custom domain attached,
Pages stops serving its content at `<user>.github.io/<repo>/` — it returns 404.
The only route to the content is the custom hostname, which is proxied through
Cloudflare and therefore behind the door. (Verified: `tommyroar.github.io/walksheds/`
404s today.) The corollary is a config-drift risk, not an open door: if the
custom domain were ever removed from the preview repo, the `github.io` path would
begin serving. Keep the domain attached.

`enable_preview_gate` deliberately controls the DNS record **and** the Access
resources together. A hostname that resolves before the door exists would
publish an unreviewed dataset, so the flag makes that state unreachable.

## Prerequisites (one-time, needs the Cloudflare dashboard)

As of writing, the `tommyroar-dev` account has **no Zero Trust organization and
no identity providers** (`access/identity_providers` returns zero, and
`access/organizations` is denied to the DNS token). Access cannot function until
that exists, so this is the blocking step:

1. **Enable Zero Trust** on the `tommyroar-dev` account and choose a team domain
   (`<team>.cloudflareaccess.com`). Free tier covers 50 users.
2. **Pick the login method.**
   - *Nothing to set up:* the built-in one-time PIN emails a code. This is what
     `infra/preview.tf` uses by default, allowing
     `var.preview_allowed_emails`.
   - *GitHub sign-in:* add a GitHub identity provider, which needs a GitHub
     OAuth app (client ID + secret). Then set `preview_github_idp_id` and the
     policy switches to allowing the `robogeosociety` org.
3. **A Cloudflare API token that can write Access.** The token in
   `infra/terraform.tfvars` can read `access/apps` and `access/policies` but not
   `access/groups` or `access/organizations`, so it is not sufficient. Vend one
   with Zero Trust: Access: Apps and Policies Edit via `/tf-vend` — which itself
   needs `/Volumes/dev` on the mini un-wedged.

## Bringing it up

```bash
# 1. Create the preview Pages repo and its workflow.
gh repo create robogeosociety/walksheds-honolulu --public \
  --description 'Gated Honolulu preview of walksheds.xyz'
# add infra/preview-repo/deploy.yml as .github/workflows/deploy.yml there,
# set Pages source to "GitHub Actions", and set the custom domain to
# honolulu.walksheds.xyz

# 2. Create the DNS record and the Access door together.
cd infra
tofu apply -var enable_preview_gate=true          # add -var preview_github_idp_id=... for GitHub sign-in

# 3. Publish.
gh workflow run 'Deploy Honolulu preview' --repo robogeosociety/walksheds-honolulu
```

Order matters: step 2 before step 3, so the door exists before any content does.

## Launching Honolulu publicly

Set `preview=False` on `HONOLULU` in `data/cities.py`, run
`python3 data/cities.py`, and the next `walksheds.xyz` deploy includes it. Then
`tofu apply -var enable_preview_gate=false` to retire the door and the record,
and archive the preview repo.

## Verifying the split locally

```bash
npm run build                        # public: dist/cities/ has seattle only
VITE_PREVIEW_CITIES=1 npm run build  # preview: dist/cities/ has both
```

`src/__tests__/previewCities.test.js` covers the filtering rule, including that
the public registry never keeps a `defaultCity` pointing at a removed city.
