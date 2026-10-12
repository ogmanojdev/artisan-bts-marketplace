import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/artisan"),
  GCP_PROJECT_ID: z.string().default("local-project"),
  GCP_REGION: z.string().default("asia-south1"),
  RAW_BUCKET: z.string().default("artisan-raw-videos"),
  /** Public base URL of the segments bucket behind Cloud CDN, e.g. https://media.example.com */
  MEDIA_BASE_URL: z.string().default("http://localhost:9000/media"),
  TRANSCODE_JOB_NAME: z.string().default("transcoder"),
  /** Comma-separated web origins allowed to call the API and upload to GCS. */
  ALLOWED_ORIGINS: z.string().default("http://localhost:8081"),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  /** Audience for OIDC tokens on internal Pub/Sub push endpoints (the API's own URL). */
  INTERNAL_AUDIENCE: z.string().default(""),
  PUBSUB_PUSH_SA: z.string().default(""),
  ORDER_HOLD_MINUTES: z.coerce.number().default(15),
  /** Local only: accept `Bearer dev:<uid>:<role>` tokens instead of Firebase ID tokens. */
  DEV_AUTH: z.enum(["true", "false"]).default("false"),
});

export const env = Env.parse(process.env);
export const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
