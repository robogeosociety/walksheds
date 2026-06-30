provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# 1. Look up the existing Cloudflare Zone
data "cloudflare_zone" "main" {
  filter = {
    name = var.domain_name
  }
}

# 2. Configure DNS for GitHub Pages.
# Apex uses CNAME flattening (proxied) so Cloudflare serves the user-facing TLS
# and forwards to GitHub Pages' edge. Origin TLS (CF → GH Pages) uses GH's own
# Let's Encrypt cert + zone setting `ssl = full`.
resource "cloudflare_dns_record" "apex" {
  zone_id = data.cloudflare_zone.main.id
  name    = "@"
  content = "${var.github_pages_user}.github.io"
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "www" {
  zone_id = data.cloudflare_zone.main.id
  name    = "www"
  content = var.domain_name
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# wiki.walksheds.xyz — the reader-facing guide, served from a separate GitHub
# Pages site (tommyroar/walksheds-wiki, since GitHub Pages allows only one custom
# domain per repo). Same GH Pages edge + CNAME-flattening + `ssl = full` model
# as the apex.
resource "cloudflare_dns_record" "wiki" {
  zone_id = data.cloudflare_zone.main.id
  name    = "wiki"
  content = "${var.github_pages_user}.github.io"
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# dev.wiki.walksheds.xyz — the engineering codex, on its own GitHub Pages site
# (tommyroar/walksheds-dev-wiki).
#
# DNS-only (grey cloud), unlike the proxied apex/www/wiki records. This is a
# SECOND-level subdomain, and Cloudflare's Universal SSL wildcard (`*.walksheds.xyz`)
# does NOT cover a second level — a proxied `dev.wiki` has no edge cert and fails the
# TLS handshake (would need Advanced Certificate Manager / Total TLS). DNS-only takes
# Cloudflare out of the TLS path so GitHub Pages serves its own per-hostname Let's
# Encrypt cert, which covers any subdomain depth. (`wiki`, being first-level, is
# covered by Universal SSL and stays proxied.)
resource "cloudflare_dns_record" "dev_wiki" {
  zone_id = data.cloudflare_zone.main.id
  name    = "dev.wiki"
  content = "${var.github_pages_user}.github.io"
  type    = "CNAME"
  proxied = false
  ttl     = 1
}

# 3. HTTPS settings.
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = data.cloudflare_zone.main.id
  setting_id = "ssl"
  value      = "full"
}

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = data.cloudflare_zone.main.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = data.cloudflare_zone.main.id
  setting_id = "min_tls_version"
  value      = "1.2"
}
