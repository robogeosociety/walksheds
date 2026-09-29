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

variable "cloudflare_account_id" {
  description = "Cloudflare account owning the zone; needed for Zero Trust Access resources."
  type        = string
  default     = "d7adee58513c1b2f770ccaac90cf114f" # tommyroar-dev
}

# The gated Honolulu preview. Off by default and deliberately controls BOTH the
# DNS record and the Access policy, so the hostname cannot resolve before the
# door exists — turning this on without the gate would publish an unreviewed
# dataset. See docs/honolulu-preview.md for the prerequisites.
variable "enable_preview_gate" {
  description = "Create honolulu.walksheds.xyz and the Cloudflare Access door in front of it."
  type        = bool
  default     = false
}

variable "preview_allowed_emails" {
  description = "Emails allowed through the preview door when using the built-in one-time-PIN login."
  type        = list(string)
  default     = ["tommy.b.doerr@gmail.com"]
}

variable "preview_github_idp_id" {
  description = <<-EOT
    Cloudflare Access identity-provider ID for GitHub. Empty means the door uses
    the built-in one-time PIN (email) login, which needs no OAuth app. Set this
    to switch the door to GitHub sign-in once an IdP exists in the account.
  EOT
  type        = string
  default     = ""
}
