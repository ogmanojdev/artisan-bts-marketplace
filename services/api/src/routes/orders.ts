import type { FastifyInstance } from "fastify";
import { CreateOrderInput, type CreateOrderResponse, type OrderView } from "@artisan/shared";
import { requireUser } from "../auth.js";
import { pool, tx } from "../db.js";
import { env } from "../env.js";
import { createProviderOrder } from "../payments.js";

type OrderRow = {
  id: string;
  status: OrderView["status"];
  product_id: string;
  quantity: number;
  amount_minor: number;
  currency: string;
  provider_order_id: string | null;
  expires_at: Date;
  created_at: Date;
};

function toResponse(o: OrderRow): CreateOrderResponse {
  return {
    orderId: o.id,
    status: o.status,
    amount: { amountMinor: o.amount_minor, currency: o.currency },
    payment: { provider: "razorpay", providerOrderId: o.provider_order_id ?? "", keyId: env.RAZORPAY_KEY_ID },
    expiresAt: o.expires_at.toISOString(),
  };
}

export async function orderRoutes(app: FastifyInstance) {
  /**
   * Order placement. Stock is reserved atomically with a conditional decrement, so a one-of-one
   * handmade piece can never be sold twice. Retries with the same Idempotency-Key return the
   * original order instead of creating a second one.
   */
  app.post("/v1/orders", { preHandler: requireUser() }, async (req, reply) => {
    const input = CreateOrderInput.parse(req.body);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 100) {
      return reply.code(400).send({ error: "Idempotency-Key header required" });
    }
    const user = req.user!;

    const existing = await pool.query<OrderRow>("SELECT * FROM orders WHERE buyer_id = $1 AND idempotency_key = $2", [user.uid, key]);
    if (existing.rows[0]) return reply.code(200).send(toResponse(existing.rows[0]));

    const order = await tx(async (c) => {
      await c.query(
        `INSERT INTO users (id, display_name, role) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [user.uid, user.name, user.role],
      );
      const reserved = await c.query<{ price_minor: number; currency: string }>(
        `UPDATE products SET stock = stock - $2
         WHERE id = $1 AND published AND stock >= $2
         RETURNING price_minor, currency`,
        [input.productId, input.quantity],
      );
      const p = reserved.rows[0];
      if (!p) return null;
      const { rows } = await c.query<OrderRow>(
        `INSERT INTO orders (buyer_id, product_id, quantity, amount_minor, currency, status, idempotency_key, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING_PAYMENT', $6, now() + make_interval(mins => $7))
         RETURNING *`,
        [user.uid, input.productId, input.quantity, p.price_minor * input.quantity, p.currency, key, env.ORDER_HOLD_MINUTES],
      );
      return rows[0]!;
    });

    if (!order) return reply.code(409).send({ error: "Out of stock" });

    const providerOrderId = await createProviderOrder(order.id, order.amount_minor, order.currency);
    const { rows } = await pool.query<OrderRow>(
      "UPDATE orders SET provider_order_id = $2 WHERE id = $1 RETURNING *",
      [order.id, providerOrderId],
    );
    return reply.code(201).send(toResponse(rows[0]!));
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", { preHandler: requireUser() }, async (req, reply) => {
    const { rows } = await pool.query<OrderRow>("SELECT * FROM orders WHERE id = $1 AND buyer_id = $2", [req.params.id, req.user!.uid]);
    const o = rows[0];
    if (!o) return reply.code(404).send({ error: "Not found" });
    const view: OrderView = {
      orderId: o.id,
      status: o.status,
      productId: o.product_id,
      quantity: o.quantity,
      amount: { amountMinor: o.amount_minor, currency: o.currency },
      createdAt: o.created_at.toISOString(),
    };
    return view;
  });
}
