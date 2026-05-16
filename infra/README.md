# infra/

Terraform module managing Cloudflare DNS for `walksheds.xyz`. The site itself is hosted on GitHub Pages from the repo root; this module just wires the apex + `www` records to GitHub's edge.

## One-time setup

1. **Cloudflare zone**: add `walksheds.xyz` to your Cloudflare account and update the registrar's nameservers to the pair Cloudflare assigns. Wait for the zone to go "Active" in the dashboard.
2. **API token**: https://dash.cloudflare.com/profile/api-tokens → *Create Token* → custom token with `Zone:DNS:Edit` scoped to `walksheds.xyz`.
3. **Zone ID**: dashboard → `walksheds.xyz` → Overview → right sidebar.
4. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in the two values. `terraform.tfvars` is gitignored.

## Apply

```bash
cd infra
terraform init
terraform plan    # expect 9 records to be added (4 A + 4 AAAA + 1 CNAME)
terraform apply
```

## What this creates

- Four `A` records on `@` pointing at GitHub Pages' apex IPs.
- Four `AAAA` records on `@` for IPv6.
- One `CNAME` from `www` → `<github_pages_user>.github.io` so `www.walksheds.xyz` redirects via GitHub Pages.

All records are **DNS-only** (gray cloud). Proxying them through Cloudflare breaks GitHub Pages' Let's Encrypt provisioning for the custom domain. If you later want Cloudflare's CDN/analytics in front, switch SSL mode to *Full (strict)* first, then flip `proxied = true` here.

## State

State is stored locally (no remote backend). `*.tfstate*` is gitignored. The single-contributor zone doesn't justify a remote backend; revisit if that changes.
