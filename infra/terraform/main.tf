locals {
  services = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "identitytoolkit.googleapis.com",
    "iamcredentials.googleapis.com",
    "iam.googleapis.com",
    "sts.googleapis.com",
  ]
  web_origins = ["https://${var.web_domain}", "http://localhost:8081"]
  # Deterministic Cloud Run URL: used as the OIDC audience on both sides of internal calls.
  api_audience = "https://${var.prefix}-api-${data.google_project.this.number}.${var.region}.run.app"
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.prefix
  format        = "DOCKER"
  depends_on    = [google_project_service.enabled]
}

# ---------- Service accounts ----------
resource "google_service_account" "api" {
  account_id   = "${var.prefix}-api"
  display_name = "Artisan API (Cloud Run)"
}

resource "google_service_account" "transcoder" {
  account_id   = "${var.prefix}-transcoder"
  display_name = "Artisan transcoder (Cloud Run Job)"
}

resource "google_service_account" "internal_invoker" {
  account_id   = "${var.prefix}-internal"
  display_name = "Pub/Sub push + Cloud Scheduler caller for /internal endpoints"
}

# ---------- Secrets ----------
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.prefix}-database-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgres://app:${random_password.db.result}@/artisan?host=/cloudsql/${google_sql_database_instance.pg.connection_name}"
}

# Set these two values out of band: gcloud secrets versions add <name> --data-file=-
resource "google_secret_manager_secret" "razorpay_key_secret" {
  secret_id = "${var.prefix}-razorpay-key-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "razorpay_webhook_secret" {
  secret_id = "${var.prefix}-razorpay-webhook-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "api_secrets" {
  for_each = {
    db      = google_secret_manager_secret.database_url.id
    rzp     = google_secret_manager_secret.razorpay_key_secret.id
    webhook = google_secret_manager_secret.razorpay_webhook_secret.id
  }
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "transcoder_db" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.transcoder.email}"
}

# ---------- Cloud SQL (PostgreSQL) ----------
resource "google_sql_database_instance" "pg" {
  name             = "${var.prefix}-pg"
  database_version = "POSTGRES_16"
  region           = var.region
  settings {
    tier              = var.db_tier
    availability_type = "ZONAL" # switch to REGIONAL for production HA
    disk_autoresize   = true
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
    ip_configuration {
      ipv4_enabled = true # reached only via the Cloud SQL connector (IAM-authorised), no authorised networks
    }
    insights_config {
      query_insights_enabled = true
    }
  }
  deletion_protection = true
  depends_on          = [google_project_service.enabled]
}

resource "google_sql_database" "app" {
  name     = "artisan"
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_user" "app" {
  name     = "app"
  instance = google_sql_database_instance.pg.name
  password = random_password.db.result
}

resource "google_project_iam_member" "sql_clients" {
  for_each = toset([google_service_account.api.email, google_service_account.transcoder.email])
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${each.value}"
}
