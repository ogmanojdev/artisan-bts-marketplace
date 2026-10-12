# One global external HTTPS load balancer, three hosts:
#   api.*   → Cloud Run API (serverless NEG), protected by Cloud Armor
#   media.* → segments bucket with Cloud CDN (immutable segments cached at the edge)
#   app.*   → Expo web static export with Cloud CDN
# HTTP/3 (QUIC) is enabled: far better than TCP on lossy, high-latency mobile links.

resource "google_compute_global_address" "lb" {
  name = "${var.prefix}-lb-ip"
}

resource "google_compute_managed_ssl_certificate" "lb" {
  name = "${var.prefix}-cert"
  managed {
    domains = [var.api_domain, var.media_domain, var.web_domain]
  }
}

resource "google_compute_region_network_endpoint_group" "api" {
  name                  = "${var.prefix}-api-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

resource "google_compute_security_policy" "api" {
  name = "${var.prefix}-api-armor"
  rule {
    action   = "throttle"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 600
        interval_sec = 60
      }
    }
  }
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_backend_service" "api" {
  name                  = "${var.prefix}-api-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.api.id
  compression_mode      = "AUTOMATIC" # gzip/brotli JSON for slow links
  backend {
    group = google_compute_region_network_endpoint_group.api.id
  }
  log_config {
    enable      = true
    sample_rate = 0.2
  }
}

resource "google_compute_backend_bucket" "media" {
  name        = "${var.prefix}-media-backend"
  bucket_name = google_storage_bucket.media.name
  enable_cdn  = true
  cdn_policy {
    cache_mode        = "USE_ORIGIN_HEADERS" # segments: 1 y immutable, manifests: 5 min
    serve_while_stale = 86400
    negative_caching  = true
  }
}

resource "google_compute_backend_bucket" "web" {
  name             = "${var.prefix}-web-backend"
  bucket_name      = google_storage_bucket.web.name
  enable_cdn       = true
  compression_mode = "AUTOMATIC"
  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    default_ttl       = 300
    serve_while_stale = 86400
  }
}

resource "google_compute_url_map" "lb" {
  name            = "${var.prefix}-urlmap"
  default_service = google_compute_backend_bucket.web.id

  host_rule {
    hosts        = [var.api_domain]
    path_matcher = "api"
  }
  host_rule {
    hosts        = [var.media_domain]
    path_matcher = "media"
  }
  host_rule {
    hosts        = [var.web_domain]
    path_matcher = "web"
  }

  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.api.id
    # Internal endpoints are never routed from the public edge.
    path_rule {
      paths   = ["/internal/*"]
      service = google_compute_backend_bucket.web.id
    }
  }
  path_matcher {
    name            = "media"
    default_service = google_compute_backend_bucket.media.id
  }
  path_matcher {
    name            = "web"
    default_service = google_compute_backend_bucket.web.id
  }
}

resource "google_compute_target_https_proxy" "lb" {
  name             = "${var.prefix}-https-proxy"
  url_map          = google_compute_url_map.lb.id
  ssl_certificates = [google_compute_managed_ssl_certificate.lb.id]
  quic_override    = "ENABLE"
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.prefix}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.lb.id
}

# HTTP → HTTPS redirect.
resource "google_compute_url_map" "redirect" {
  name = "${var.prefix}-http-redirect"
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${var.prefix}-http-proxy"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${var.prefix}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
}
