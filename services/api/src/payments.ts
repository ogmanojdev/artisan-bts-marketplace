import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { env } from "./env.js";

const client = env.RAZORPAY_KEY_ID ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }) : null;

export async function createProviderOrder(orderId: string, amountMinor: number, currency: string): Promise<string> {
  if (!client) return `order_dev_${orderId.slice(0, 8)}`; // local dev without Razorpay keys
  const order = await client.orders.create({ amount: amountMinor, currency, receipt: orderId, notes: { orderId } });
  return order.id;
}

/** Razorpay signs the raw webhook body with HMAC-SHA256 using the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
