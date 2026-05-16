variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS:Edit + Zone:Settings:Edit on walksheds.xyz."
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "The domain name registered in Cloudflare."
  type        = string
  default     = "walksheds.xyz"
}

variable "github_pages_user" {
  description = "Owner of the GitHub Pages repo; used as <user>.github.io target for the apex CNAME."
  type        = string
  default     = "tommyroar"
}
