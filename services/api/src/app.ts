import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { allowedOrigins } from "./env.js";
import { internalRoutes } from "./routes/internal.js";
import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";
import { webhookRoutes } from "./routes/webhooks.js";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", messageKey: "message" }, // Cloud Logging friendly
    trustProxy: true,
    bodyLimit: 256 * 1024, // video bytes go straight to GCS, never through the API
  });

  await app.register(cors, { origin: allowedOrigins, allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid request", issues: err.issues });
    req.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status >= 500 ? "Something went wrong" : (err as Error).message });
  });

  app.get("/healthz", async () => ({ ok: true }));
  await app.register(productRoutes);
  await app.register(orderRoutes);
  await app.register(webhookRoutes); // own scope: raw-body JSON parser for signature checks
  await app.register(internalRoutes); // own scope: OIDC-only hook

  return app;
}
