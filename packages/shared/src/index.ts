import { z } from "zod";

/** Hard product rule: process videos may be at most 15 minutes long. */
export const MAX_VIDEO_SECONDS = 15 * 60;

export const VideoStatus = z.enum(["AWAITING_UPLOAD", "PROCESSING", "READY", "FAILED"]);
export type VideoStatus = z.infer<typeof VideoStatus>;

export const OrderStatus = z.enum(["PENDING_PAYMENT", "PLACED", "EXPIRED", "FAILED"]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Prices are stored in the smallest currency unit (paise for INR). */
export const Money = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default("INR"),
});

export const CreateProductInput = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  price: Money,
  stock: z.number().int().min(1).max(10_000).default(1),
  tags: z.array(z.string().trim().toLowerCase().min(2).max(32)).max(15).default([]),
  video: z.object({
    fileName: z.string().min(1).max(255),
    contentType: z.string().regex(/^video\//),
    sizeBytes: z.number().int().positive(),
    /** Client-measured duration; the transcoder re-validates with ffprobe. */
    durationSeconds: z.number().positive().max(MAX_VIDEO_SECONDS),
  }),
});
export type CreateProductInput = z.infer<typeof CreateProductInput>;

export const CreateProductResponse = z.object({
  productId: z.string().uuid(),
  /** GCS resumable session URI. Client PUTs chunks here directly. */
  uploadSessionUri: z.string().url(),
});
export type CreateProductResponse = z.infer<typeof CreateProductResponse>;

export const VideoAssets = z.object({
  status: VideoStatus,
  /** Multi-codec CMAF HLS master playlist (AV1 + H.264 ladders). */
  hlsUrl: z.string().url().nullable(),
  /** DASH manifest, preferred by Shaka on web. */
  dashUrl: z.string().url().nullable(),
  posterUrl: z.string().url().nullable(),
  storyboardUrl: z.string().url().nullable(),
  highlightHlsUrl: z.string().url().nullable(),
  durationSeconds: z.number().nullable(),
});
export type VideoAssets = z.infer<typeof VideoAssets>;

export const ProductSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  price: Money,
  tags: z.array(z.string()),
  artisanName: z.string(),
  inStock: z.boolean(),
  posterUrl: z.string().url().nullable(),
  /** Lowest rung playlist, used for prefetching the first segments. */
  previewHlsUrl: z.string().url().nullable(),
});
export type ProductSummary = z.infer<typeof ProductSummary>;

export const ProductDetail = ProductSummary.extend({
  description: z.string(),
  stock: z.number().int(),
  video: VideoAssets,
});
export type ProductDetail = z.infer<typeof ProductDetail>;

export const SearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((t) => (t === undefined ? [] : Array.isArray(t) ? t : t.split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean)),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResponse = z.object({
  items: z.array(ProductSummary),
  nextCursor: z.string().nullable(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const CreateOrderInput = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

export const CreateOrderResponse = z.object({
  orderId: z.string().uuid(),
  status: OrderStatus,
  amount: Money,
  payment: z.object({
    provider: z.literal("razorpay"),
    providerOrderId: z.string(),
    keyId: z.string(),
  }),
  expiresAt: z.string(),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

export const OrderView = z.object({
  orderId: z.string().uuid(),
  status: OrderStatus,
  productId: z.string().uuid(),
  quantity: z.number().int(),
  amount: Money,
  createdAt: z.string(),
});
export type OrderView = z.infer<typeof OrderView>;
