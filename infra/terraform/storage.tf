# Raw uploads: private. Browsers PUT chunks directly via resumable session URIs, so CORS is needed.
resource "google_storage_bucket" "raw" {
  name                        = "${var.project_id}-${var.prefix}-raw"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  cors {
    origin          = local.web_origins
    method          = ["PUT", "POST", "OPTIONS"]
    response_header = ["Content-Type", "Content-Range", "Range", "X-Goog-Upload-Status"]
    max_age_seconds = 3600
  }

  # Originals aren't needed once encoded; keep a window for re-encodes with a new ladder.
  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }
}

# Encoded segments, manifests, posters: public, served through Cloud CDN.
resource "google_storage_bucket" "media" {
  name                        = "${var.project_id}-${var.prefix}-media"
  location                    = var.region
  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Range"]
    max_age_seconds = 86400
  }
}

resource "google_storage_bucket_iam_member" "media_public" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Expo web static export.
resource "google_storage_bucket" "web" {
  name                        = "${var.project_id}-${var.prefix}-web"
  location                    = var.region
  uniform_bucket_level_access = true
  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
}

resource "google_storage_bucket_iam_member" "web_public" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ---------- IAM on buckets ----------
# API creates resumable upload sessions on the raw bucket.
resource "google_storage_bucket_iam_member" "api_raw" {
  bucket = google_storage_bucket.raw.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "transcoder_raw" {
  bucket = google_storage_bucket.raw.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.transcoder.email}"
}

resource "google_storage_bucket_iam_member" "transcoder_media" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.transcoder.email}"
}

# ---------- Upload → transcode events ----------
resource "google_pubsub_topic" "raw_uploads" {
  name = "${var.prefix}-raw-uploads"
}

data "google_storage_project_service_account" "gcs" {}

resource "google_pubsub_topic_iam_member" "gcs_publish" {
  topic  = google_pubsub_topic.raw_uploads.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

resource "google_storage_notification" "raw_finalize" {
  bucket         = google_storage_bucket.raw.name
  topic          = google_pubsub_topic.raw_uploads.id
  payload_format = "JSON_API_V1"
  event_types    = ["OBJECT_FINALIZE"]
  object_name_prefix = "raw/"
  depends_on     = [google_pubsub_topic_iam_member.gcs_publish]
}

resource "google_pubsub_topic" "raw_uploads_dlq" {
  name = "${var.prefix}-raw-uploads-dlq"
}

resource "google_pubsub_subscription" "raw_uploads_push" {
  name                 = "${var.prefix}-raw-uploads-push"
  topic                = google_pubsub_topic.raw_uploads.id
  ack_deadline_seconds = 60
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.api.uri}/internal/gcs-finalized"
    oidc_token {
      service_account_email = google_service_account.internal_invoker.email
      audience              = local.api_audience
    }
  }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.raw_uploads_dlq.id
    max_delivery_attempts = 10
  }
}

# Emitted when an order is placed. Fulfilment (out of scope) subscribes here later.
resource "google_pubsub_topic" "order_events" {
  name = "order-events"
}

resource "google_pubsub_topic_iam_member" "api_publish_orders" {
  topic  = google_pubsub_topic.order_events.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.api.email}"
}
