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
