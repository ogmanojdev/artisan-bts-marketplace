/** Local only: an API without Razorpay keys issues `order_dev_*` ids and confirms them itself. */
import type { CreateOrderResponse } from "@artisan/shared";
import { api } from "@/api";

export const isDevOrder = (order: CreateOrderResponse) => order.payment.providerOrderId.startsWith("order_dev_");

export async function devPay(order: CreateOrderResponse): Promise<"submitted"> {
  await api.devPay(order.orderId);
  return "submitted";
}
