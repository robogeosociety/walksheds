variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token with Zone:DNS:Edit on walksheds.xyz."
}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID for walksheds.xyz (from CF dashboard sidebar)."
}

variable "github_pages_user" {
  type        = string
  default     = "tommyroar"
  description = "Owner of the GitHub Pages repo; used as <user>.github.io target for the www CNAME."
}
