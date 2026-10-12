import type { FastifyInstance } from "fastify";
import { PubSub } from "@google-cloud/pubsub";
import { pool } from "../db.js";
import { env } from "../env.js";
import { verifyWebhookSignature } from "../payments.js";

const pubsub = new PubSub({ projectId: env.GCP_PROJECT_ID });

type RazorpayEvent = {
  event: string;
  payload: { payment?: { entity: { id: string; order_id: string; status: string } } };
};

/**
 * Razorpay → us. `payment.captured` marks the order PLACED: that is the end of the in-scope
 * journey. We publish `order.placed` so fulfilment (out of scope) can subscribe later.
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/v1/webhooks/razorpay", async (req, reply) => {
    const raw = req.body as Buffer;
    if (!verifyWebhookSignature(raw, req.headers["x-razorpay-signature"] as string | undefined)) {
      return reply.code(401).send();
    }
    const evt = JSON.parse(raw.toString("utf8")) as RazorpayEvent;
    const payment = evt.payload.payment?.entity;
    if (!payment) return reply.code(200).send();

    if (evt.event === "payment.captured") {
      const { rows } = await pool.query<{ id: string; product_id: string; buyer_id: string; amount_minor: number }>(
        `UPDATE orders SET status = 'PLACED', provider_payment_id = $2, placed_at = now()
         WHERE provider_order_id = $1 AND status = 'PENDING_PAYMENT'
         RETURNING id, product_id, buyer_id, amount_minor`,
        [payment.order_id, payment.id],
      );
      const o = rows[0];
      if (o) {
        await pubsub.topic("order-events").publishMessage({
          json: { type: "order.placed", orderId: o.id, productId: o.product_id, buyerId: o.buyer_id, amountMinor: o.amount_minor },
          attributes: { type: "order.placed" },
        });
      }
    } else if (evt.event === "payment.failed") {
      // Leave the hold in place until expiry so the buyer can retry with another method.
      req.log.info({ orderId: payment.order_id }, "payment failed; hold retained until expiry");
    }
    return reply.code(200).send();
  });
}
