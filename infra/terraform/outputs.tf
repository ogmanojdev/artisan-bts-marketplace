output "lb_ip" {
  description = "Point A records for the api, media and web domains here. Null when enable_edge = false."
  value       = var.enable_edge ? google_compute_global_address.lb[0].address : null
}

output "web_url" {
  value = local.web_base_url
}

output "media_url" {
  value = local.media_base_url
}

output "api_run_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "raw_bucket" {
  value = google_storage_bucket.raw.name
}

output "media_bucket" {
  value = google_storage_bucket.media.name
}

output "web_bucket" {
  value = google_storage_bucket.web.name
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "cloudsql_connection_name" {
  value = google_sql_database_instance.pg.connection_name
}

# Copy these into the repo's Actions variables (gh variable set), see
# .github/workflows/deploy.yml for the full list it expects.
output "gha_workload_identity_provider" {
  description = "-> GCP_WIF_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "gha_deploy_service_account" {
  description = "-> GCP_DEPLOY_SA"
  value       = google_service_account.github_deploy.email
}
