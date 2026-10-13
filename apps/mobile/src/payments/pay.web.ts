/** Web: Razorpay Checkout.js, loaded lazily so it never costs bytes on browse-only visits. */
import type { CreateOrderResponse } from "@artisan/shared";
import { devPay, isDevOrder } from "./devPay";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load payment script"));
    document.head.appendChild(s);
  });
}

export async function pay(order: CreateOrderResponse, description: string): Promise<"submitted" | "dismissed"> {
  if (isDevOrder(order)) return devPay(order);
  await loadScript();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: order.payment.keyId,
      order_id: order.payment.providerOrderId,
      amount: order.amount.amountMinor,
      currency: order.amount.currency,
      name: "Makers BTS",
      description,
      handler: () => resolve("submitted"),
      modal: { ondismiss: () => resolve("dismissed") },
    });
    rzp.open();
  });
}
