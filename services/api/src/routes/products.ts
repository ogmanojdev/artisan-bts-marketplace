import type { FastifyInstance } from "fastify";
import { Storage } from "@google-cloud/storage";
import { CreateProductInput, SearchQuery, type ProductDetail, type ProductSummary } from "@artisan/shared";
import { requireUser } from "../auth.js";
import { pool, tx } from "../db.js";
import { allowedOrigins, env } from "../env.js";
import { mediaUrl, rawObjectName } from "../media.js";

const storage = new Storage({ projectId: env.GCP_PROJECT_ID });

type Row = {
  id: string;
  title: string;
  description: string;
  price_minor: number;
  currency: string;
  stock: number;
  tags: string[];
  artisan_name: string;
  status: ProductDetail["video"]["status"];
  duration_seconds: string | null;
  hls_path: string | null;
  dash_path: string | null;
  preview_hls_path: string | null;
  highlight_hls_path: string | null;
  poster_path: string | null;
  storyboard_path: string | null;
};

const SELECT = `
  SELECT p.id, p.title, p.description, p.price_minor, p.currency, p.stock, p.tags,
         u.display_name AS artisan_name, v.status, v.duration_seconds, v.hls_path, v.dash_path,
         v.preview_hls_path, v.highlight_hls_path, v.poster_path, v.storyboard_path
  FROM products p
  JOIN users u ON u.id = p.artisan_id
  JOIN videos v ON v.product_id = p.id`;

function summary(r: Row): ProductSummary {
  return {
    id: r.id,
    title: r.title,
    price: { amountMinor: r.price_minor, currency: r.currency },
    tags: r.tags,
    artisanName: r.artisan_name,
    inStock: r.stock > 0,
    posterUrl: mediaUrl(r.poster_path),
    previewHlsUrl: mediaUrl(r.preview_hls_path),
  };
}

const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString("base64url");
const decodeCursor = (c?: string) => (c ? Number(Buffer.from(c, "base64url").toString()) || 0 : 0);

export async function productRoutes(app: FastifyInstance) {
  /** Keyword + tag + price search. Results carry poster and L0 preview URLs for instant playback. */
  app.get("/v1/products", async (req, reply) => {
    const q = SearchQuery.parse(req.query);
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [];
    const where = ["p.published"];
    let rank: string | null = null;

    if (q.q) {
      params.push(q.q);
      const i = params.length;
      where.push(`(p.search @@ websearch_to_tsquery('simple', $${i}) OR p.title % $${i})`);
      rank = `ts_rank(p.search, websearch_to_tsquery('simple', $${i})) + similarity(p.title, $${i})`;
    }
    if (q.tags.length) {
      params.push(q.tags);
      where.push(`p.tags @> $${params.length}::text[]`);
    }
    if (q.minPrice !== undefined) {
      params.push(q.minPrice);
      where.push(`p.price_minor >= $${params.length}`);
    }
    if (q.maxPrice !== undefined) {
      params.push(q.maxPrice);
      where.push(`p.price_minor <= $${params.length}`);
    }
    params.push(q.limit + 1, offset);

    const { rows } = await pool.query<Row>(
      `${SELECT} WHERE ${where.join(" AND ")}
       ORDER BY ${rank ? `${rank} DESC, ` : ""}p.created_at DESC, p.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const hasMore = rows.length > q.limit;
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    return {
      items: rows.slice(0, q.limit).map(summary),
      nextCursor: hasMore ? encodeCursor(offset + q.limit) : null,
    };
  });

  app.get<{ Params: { id: string } }>("/v1/products/:id", async (req, reply) => {
    const { rows } = await pool.query<Row>(`${SELECT} WHERE p.id = $1`, [req.params.id]);
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: "Not found" });
    reply.header("Cache-Control", "public, max-age=15, stale-while-revalidate=120");
    const detail: ProductDetail = {
      ...summary(r),
      description: r.description,
      stock: r.stock,
      video: {
        status: r.status,
        hlsUrl: mediaUrl(r.hls_path),
        dashUrl: mediaUrl(r.dash_path),
        posterUrl: mediaUrl(r.poster_path),
        storyboardUrl: mediaUrl(r.storyboard_path),
        highlightHlsUrl: mediaUrl(r.highlight_hls_path),
        durationSeconds: r.duration_seconds ? Number(r.duration_seconds) : null,
      },
    };
    return detail;
  });

  /**
   * Artisan creates a draft listing and receives a GCS resumable session URI.
   * The video bytes never pass through Cloud Run (no request-size or timeout limits apply).
   */
  app.post("/v1/products", { preHandler: requireUser("artisan") }, async (req, reply) => {
    const input = CreateProductInput.parse(req.body);
    const user = req.user!;

    const productId = await tx(async (c) => {
      await c.query(
        `INSERT INTO users (id, display_name, role) VALUES ($1, $2, 'artisan')
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [user.uid, user.name],
      );
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO products (artisan_id, title, description, price_minor, currency, stock, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user.uid, input.title, input.description, input.price.amountMinor, input.price.currency, input.stock, input.tags],
      );
      const id = rows[0]!.id;
      await c.query(
        `INSERT INTO videos (product_id, status, raw_object, declared_seconds) VALUES ($1, 'AWAITING_UPLOAD', $2, $3)`,
        [id, rawObjectName(id, input.video.fileName), input.video.durationSeconds],
      );
      return id;
    });

    const { rows } = await pool.query<{ raw_object: string }>("SELECT raw_object FROM videos WHERE product_id = $1", [productId]);
    const origin = req.headers.origin && allowedOrigins.includes(req.headers.origin) ? req.headers.origin : undefined;
    const [uploadSessionUri] = await storage
      .bucket(env.RAW_BUCKET)
      .file(rows[0]!.raw_object)
      .createResumableUpload({
        origin, // lets the browser read GCS responses (CORS) during the upload
        metadata: { contentType: input.video.contentType, metadata: { productId, artisanId: user.uid } },
      });

    return reply.code(201).send({ productId, uploadSessionUri });
  });
}
