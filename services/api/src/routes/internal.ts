import type { FastifyInstance } from "fastify";
import { JobsClient } from "@google-cloud/run";
import { requirePubSubPush } from "../auth.js";
import { pool, tx } from "../db.js";
import { env } from "../env.js";
import { productIdFromRawObject } from "../media.js";

const jobs = new JobsClient();

type PushBody = { message: { data: string; attributes?: Record<string, string> } };

/** Internal endpoints: called only by Pub/Sub push and Cloud Scheduler with OIDC tokens. */
export async function internalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requirePubSubPush);

  /**
   * Raw bucket OBJECT_FINALIZE notification → start one transcoder Cloud Run Job execution.
   * Duplicate deliveries are harmless: the status transition below only succeeds once.
   */
  app.post<{ Body: PushBody }>("/internal/gcs-finalized", async (req, reply) => {
    const attrs = req.body.message.attributes ?? {};
    if (attrs.eventType !== "OBJECT_FINALIZE") return reply.code(204).send();
    const objectName = attrs.objectId ?? "";
    const productId = productIdFromRawObject(objectName);
    if (!productId) return reply.code(204).send();

    const { rowCount } = await pool.query(
      `UPDATE videos SET status = 'PROCESSING', updated_at = now()
       WHERE product_id = $1 AND raw_object = $2 AND status = 'AWAITING_UPLOAD'`,
      [productId, objectName],
    );
    if (!rowCount) return reply.code(204).send();

    await jobs.runJob({
      name: `projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_REGION}/jobs/${env.TRANSCODE_JOB_NAME}`,
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "PRODUCT_ID", value: productId },
              { name: "RAW_BUCKET", value: attrs.bucketId ?? env.RAW_BUCKET },
              { name: "RAW_OBJECT", value: objectName },
            ],
          },
        ],
      },
    });
    req.log.info({ productId, objectName }, "transcode started");
    return reply.code(204).send();
  });

  /** Cloud Scheduler, every 5 min: release stock held by unpaid orders. */
  app.post("/internal/expire-orders", async () => {
    const released = await tx(async (c) => {
      const { rows } = await c.query<{ product_id: string; quantity: number }>(
        `UPDATE orders SET status = 'EXPIRED'
         WHERE status = 'PENDING_PAYMENT' AND expires_at < now()
         RETURNING product_id, quantity`,
      );
      for (const r of rows) {
        await c.query("UPDATE products SET stock = stock + $2 WHERE id = $1", [r.product_id, r.quantity]);
      }
      return rows.length;
    });
    return { released };
  });
}
