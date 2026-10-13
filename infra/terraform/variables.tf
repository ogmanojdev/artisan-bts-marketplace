variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "asia-south1" # Mumbai
}

variable "prefix" {
  type    = string
  default = "artisan"
}

variable "github_repo" {
  type        = string
  description = "owner/repo allowed to assume the GitHub Actions deploy service account"
  default     = "ogmanojdev/artisan-bts-marketplace"
}

variable "api_domain" {
  type        = string
  description = "e.g. api.example.com"
}

variable "media_domain" {
  type        = string
  description = "e.g. media.example.com — Cloud CDN in front of the segments bucket"
}

variable "web_domain" {
  type        = string
  description = "e.g. app.example.com — Expo web static export"
}

variable "api_image" {
  type        = string
  description = "Full image ref for the API, e.g. asia-south1-docker.pkg.dev/<p>/artisan/api:<sha>"
}

variable "transcoder_image" {
  type = string
}

variable "razorpay_key_id" {
  type    = string
  default = ""
}

variable "db_tier" {
  type    = string
  default = "db-custom-1-3840"
}

variable "enable_edge" {
  type        = bool
  default     = true
  description = <<-EOT
    Whether to create the global HTTPS Load Balancer, Cloud CDN, Cloud Armor and
    managed SSL cert (edge.tf) for the api/media/web custom domains. Set false for
    a cost-conscious demo/dev deploy: the API and web/media buckets are then
    reached directly over Cloud Run's and GCS's own HTTPS URLs instead, which
    avoids the LB's fixed per-hour forwarding-rule + Cloud Armor charges
    (roughly $25-35/month) and the managed cert's DNS-propagation wait.
  EOT
}

variable "transcoder_cpu" {
  type    = string
  default = "8"
}

variable "transcoder_memory" {
  type    = string
  default = "16Gi"
}
