output "lb_ip" {
  description = "Point A records for the api, media and web domains here."
  value       = google_compute_global_address.lb.address
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
