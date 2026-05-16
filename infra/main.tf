provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# GitHub Pages apex IPs.
# https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain
locals {
  github_pages_a_ips = [
    "185.199.108.153",
    "185.199.109.153",
    "185.199.110.153",
    "185.199.111.153",
  ]
  github_pages_aaaa_ips = [
    "2606:50c0:8000::153",
    "2606:50c0:8001::153",
    "2606:50c0:8002::153",
    "2606:50c0:8003::153",
  ]
}

resource "cloudflare_record" "apex_a" {
  for_each = toset(local.github_pages_a_ips)
  zone_id  = var.zone_id
  name     = "@"
  type     = "A"
  content  = each.value
  # DNS-only so GitHub Pages can provision the Let's Encrypt cert for the apex.
  proxied = false
  ttl     = 1
}

resource "cloudflare_record" "apex_aaaa" {
  for_each = toset(local.github_pages_aaaa_ips)
  zone_id  = var.zone_id
  name     = "@"
  type     = "AAAA"
  content  = each.value
  proxied  = false
  ttl      = 1
}

resource "cloudflare_record" "www_cname" {
  zone_id = var.zone_id
  name    = "www"
  type    = "CNAME"
  content = "${var.github_pages_user}.github.io"
  proxied = false
  ttl     = 1
}
