# ── honolulu.walksheds.xyz — an OPTIONAL gated preview, NOT APPLIED ─────────
#
# Nothing here is in use. Honolulu is reviewed locally instead
# (VITE_PREVIEW_CITIES=1), because a hosted door would add a Cloudflare Access
# app while robogeosociety/robot-geographical-society#187 is deleting them, in an
# account that has no Zero Trust organization. Read docs/honolulu-preview.md
# before enabling this.
#
# Replicates the Pages preview lane on its own hostname instead of overriding
# the live site, and puts a Cloudflare Access door in front of it so the
# unreviewed dataset is not public.
#
# Why this is a real gate and not decoration: GitHub Pages stops serving a
# site's content at `<user>.github.io/<repo>/` once a custom domain is attached
# (it 404s), so the only route to the content is the custom hostname — which is
# proxied through Cloudflare and therefore behind Access. The public build is
# separately stripped of the city entirely (see src/previewCities.js), so even
# the main site neither advertises nor serves it.
#
# Everything here is gated on `enable_preview_gate` so the record and the door
# are created together; a hostname that resolves without a door would publish
# the preview.

locals {
  preview_host = "honolulu"
  preview_fqdn = "${local.preview_host}.${var.domain_name}"
  preview_gate = var.enable_preview_gate ? 1 : 0
}

# First-level subdomain, so Cloudflare's Universal SSL covers it (unlike the
# second-level name discussed in main.tf). Proxied is mandatory here, not just
# conventional: Access can only sit in front of proxied traffic.
resource "cloudflare_dns_record" "honolulu_preview" {
  count   = local.preview_gate
  zone_id = data.cloudflare_zone.main.id
  name    = local.preview_host
  content = "${var.github_pages_user}.github.io"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Gated Honolulu preview (Cloudflare Access) — see infra/preview.tf"
}

resource "cloudflare_zero_trust_access_application" "honolulu_preview" {
  count            = local.preview_gate
  account_id       = var.cloudflare_account_id
  name             = "Walksheds — Honolulu preview"
  domain           = local.preview_fqdn
  type             = "self_hosted"
  session_duration = "24h"

  # The preview is for review, not for indexing or embedding.
  app_launcher_visible       = false
  auto_redirect_to_identity  = false
  http_only_cookie_attribute = true

  policies = [{
    id         = cloudflare_zero_trust_access_policy.honolulu_preview[0].id
    precedence = 1
  }]
}

resource "cloudflare_zero_trust_access_policy" "honolulu_preview" {
  count      = local.preview_gate
  account_id = var.cloudflare_account_id
  name       = "Walksheds Honolulu preview — reviewers"
  decision   = "allow"

  # With no GitHub IdP configured, fall back to the built-in one-time PIN: it
  # needs no OAuth app, so the door works the day it is created. Setting
  # preview_github_idp_id switches it to GitHub sign-in.
  include = var.preview_github_idp_id == "" ? [
    for email in var.preview_allowed_emails : { email = { email = email } }
    ] : [
    { github_organization = { identity_provider_id = var.preview_github_idp_id, name = "robogeosociety" } }
  ]
}

output "preview_url" {
  description = "The gated preview URL, once enable_preview_gate is on."
  value       = var.enable_preview_gate ? "https://${local.preview_fqdn}/" : "(preview gate disabled)"
}
