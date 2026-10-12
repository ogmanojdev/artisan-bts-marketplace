# ---------- API (Cloud Run service) ----------
resource "google_cloud_run_v2_service" "api" {
  name     = "${var.prefix}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL" # LB for clients; Pub/Sub/Scheduler call run.app with OIDC

  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = 1 # avoid cold starts on slow links
      max_instance_count = 50
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.pg.connection_name]
      }
    }
    containers {
      image = var.api_image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "RAW_BUCKET"
        value = google_storage_bucket.raw.name
      }
      env {
        name  = "MEDIA_BASE_URL"
        value = "https://${var.media_domain}"
      }
      env {
        name  = "TRANSCODE_JOB_NAME"
        value = google_cloud_run_v2_job.transcoder.name
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = join(",", local.web_origins)
      }
      env {
        name  = "RAZORPAY_KEY_ID"
        value = var.razorpay_key_id
      }
      env {
        name  = "INTERNAL_AUDIENCE"
        value = local.api_audience
      }
      env {
        name  = "PUBSUB_PUSH_SA"
        value = google_service_account.internal_invoker.email
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "RAZORPAY_KEY_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.razorpay_key_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "RAZORPAY_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.razorpay_webhook_secret.secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get {
          path = "/healthz"
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.api_secrets, google_secret_manager_secret_version.database_url]
}

# Public API (auth is enforced in-app with Identity Platform ID tokens).
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------- Transcoder (Cloud Run Job) ----------
resource "google_cloud_run_v2_job" "transcoder" {
  name     = "${var.prefix}-transcoder"
  location = var.region

  template {
    task_count = 1
    template {
      service_account = google_service_account.transcoder.email
      timeout         = "21600s" # 6 h ceiling; a 15-min video typically takes minutes
      max_retries     = 2
      volumes {
        name = "raw"
        gcs {
          bucket    = google_storage_bucket.raw.name
          read_only = true
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.pg.connection_name]
        }
      }
      containers {
        image = var.transcoder_image
        resources {
          limits = {
            cpu    = var.transcoder_cpu
            memory = var.transcoder_memory
          }
        }
        volume_mounts {
          name       = "raw"
          mount_path = "/raw"
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "MEDIA_BUCKET"
          value = google_storage_bucket.media.name
        }
        env {
          name  = "MAX_RETRIES"
          value = "2"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
        # PRODUCT_ID, RAW_BUCKET, RAW_OBJECT are supplied per execution by the API.
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.transcoder_db]
}

# API runs job executions with per-run env overrides.
resource "google_cloud_run_v2_job_iam_member" "api_runs_transcoder" {
  name     = google_cloud_run_v2_job.transcoder.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "api_act_as_transcoder" {
  service_account_id = google_service_account.transcoder.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# Pub/Sub must be able to mint OIDC tokens for the push identity.
resource "google_service_account_iam_member" "pubsub_token_creator" {
  service_account_id = google_service_account.internal_invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# ---------- Release unpaid holds every 5 minutes ----------
resource "google_cloud_scheduler_job" "expire_orders" {
  name     = "${var.prefix}-expire-orders"
  region   = var.region
  schedule = "*/5 * * * *"
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/internal/expire-orders"
    oidc_token {
      service_account_email = google_service_account.internal_invoker.email
      audience              = local.api_audience
    }
  }
}
