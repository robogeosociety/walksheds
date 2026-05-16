# infra/

Terraform module managing Cloudflare DNS + TLS settings for `walksheds.xyz`. The site itself is hosted on GitHub Pages from the repo root; this module wires the apex + `www` records to GitHub's edge via CNAME flattening and forces HTTPS.

## One-time setup

1. **Cloudflare zone**: add `walksheds.xyz` to your Cloudflare account and update the registrar's nameservers to the pair Cloudflare assigns. Wait for the zone to go "Active" in the dashboard.
2. **API token**: https://dash.cloudflare.com/profile/api-tokens → *Create Token* → custom token with `Zone:DNS:Edit` + `Zone:Settings:Edit` scoped to `walksheds.xyz`.
3. Copy `terraform.tfvars.example` to `terraform.tfvars` and paste the token in. `terraform.tfvars` is gitignored.

## Apply

```bash
cd infra
terraform init
terraform plan    # expect 5 records to be added (1 apex CNAME, 1 www CNAME, 3 zone settings)
terraform apply
```

## What this creates

- `CNAME @ → tommyroar.github.io` (proxied — CNAME flattening at the apex).
- `CNAME www → walksheds.xyz` (proxied).
- Zone settings: `ssl = full`, `always_use_https = on`, `min_tls_version = 1.2`.

Both DNS records are **proxied** (orange cloud). Cloudflare serves user-facing TLS via its Universal SSL cert; the `ssl = full` setting tells Cloudflare to re-encrypt to GitHub Pages' origin, which presents its own Let's Encrypt cert.

## State

State is stored locally (no remote backend). `*.tfstate*` is gitignored. The single-contributor zone doesn't justify a remote backend; revisit if that changes.
