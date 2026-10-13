/** Android: Razorpay native checkout (UPI intent, cards). Final status comes from the webhook. */
import RazorpayCheckout from "react-native-razorpay";
import type { CreateOrderResponse } from "@artisan/shared";
import { devPay, isDevOrder } from "./devPay";

export async function pay(order: CreateOrderResponse, description: string): Promise<"submitted" | "dismissed"> {
  if (isDevOrder(order)) return devPay(order);
  try {
    await RazorpayCheckout.open({
      key: order.payment.keyId,
      order_id: order.payment.providerOrderId,
      amount: order.amount.amountMinor,
      currency: order.amount.currency,
      name: "Makers BTS",
      description,
    });
    return "submitted";
  } catch {
    return "dismissed";
  }
}
