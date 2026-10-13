# Lets GitHub Actions (.github/workflows/deploy.yml) authenticate to this project
# without a long-lived JSON key: it exchanges a GitHub OIDC token for a short-lived
# token as the deploy service account, scoped to this one repo.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${var.prefix}-github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "${var.prefix}-github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only this repo's own workflows (any branch/PR) may mint tokens.
  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "github_deploy" {
  account_id   = "${var.prefix}-gha-deploy"
  display_name = "GitHub Actions deploy (CI/CD)"
}

# Any workflow run in this repo can impersonate the deploy SA (GCP has no branch
# concept to restrict on) — deploy.yml itself only runs on pushes to main or
# workflow_dispatch, so that's where the real restriction lives.
resource "google_service_account_iam_member" "github_deploy_wif" {
  service_account_id = google_service_account.github_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.repository/${var.github_repo}"
}

resource "google_project_iam_member" "github_deploy_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/run.developer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Deploying Cloud Run revisions that run as the api/transcoder service accounts
# requires explicit permission to act as them.
resource "google_service_account_iam_member" "github_deploy_act_as" {
  for_each = toset([
    google_service_account.api.name,
    google_service_account.transcoder.name,
  ])
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deploy.email}"
}

resource "google_storage_bucket_iam_member" "github_deploy_web" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.github_deploy.email}"
}

# `gcloud storage rsync` reads the destination bucket's metadata (storage.buckets.get),
# which objectAdmin doesn't include.
resource "google_storage_bucket_iam_member" "github_deploy_web_bucket" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.github_deploy.email}"
}
