-- Core schema: artisans/buyers, products with process videos, orders.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,               -- Identity Platform uid
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('artisan', 'buyer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artisan_id    text NOT NULL REFERENCES users(id),
  title         text NOT NULL,
  description   text NOT NULL,
  price_minor   integer NOT NULL CHECK (price_minor > 0),
  currency      char(3) NOT NULL DEFAULT 'INR',
  stock         integer NOT NULL CHECK (stock >= 0),
  tags          text[] NOT NULL DEFAULT '{}',
  published     boolean NOT NULL DEFAULT false,  -- flips true when the video is READY
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 'simple' config: no stemming, so Hindi/Telugu/transliterated titles still match.
  search        tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                  setweight(array_to_tsvector(tags), 'A') ||
                  setweight(to_tsvector('simple', coalesce(description, '')), 'B')
                ) STORED
);
CREATE INDEX IF NOT EXISTS products_search_idx ON products USING gin (search);
CREATE INDEX IF NOT EXISTS products_tags_idx ON products USING gin (tags);
CREATE INDEX IF NOT EXISTS products_title_trgm_idx ON products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_published_recent_idx ON products (created_at DESC, id) WHERE published;

CREATE TABLE IF NOT EXISTS videos (
  product_id        uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('AWAITING_UPLOAD', 'PROCESSING', 'READY', 'FAILED')),
  raw_object        text NOT NULL,
  declared_seconds  numeric NOT NULL,
  duration_seconds  numeric,
  -- Paths are relative to MEDIA_BASE_URL (Cloud CDN in front of the segments bucket).
  hls_path          text,
  dash_path         text,
  preview_hls_path  text,     -- L0-only playlist used for prefetch
  highlight_hls_path text,
  poster_path       text,
  storyboard_path   text,
  error             text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id            text NOT NULL REFERENCES users(id),
  product_id          uuid NOT NULL REFERENCES products(id),
  quantity            integer NOT NULL CHECK (quantity > 0),
  amount_minor        integer NOT NULL,
  currency            char(3) NOT NULL,
  status              text NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'PLACED', 'EXPIRED', 'FAILED')),
  provider_order_id   text UNIQUE,
  provider_payment_id text,
  idempotency_key     text NOT NULL,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  placed_at           timestamptz,
  UNIQUE (buyer_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS orders_pending_expiry_idx ON orders (expires_at) WHERE status = 'PENDING_PAYMENT';

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
