import {
  CreateOrderInput,
  CreateOrderResponse,
  CreateProductInput,
  CreateProductResponse,
  OrderView,
  ProductDetail,
  SearchResponse,
} from "@artisan/shared";
import type { z } from "zod";
import { config } from "./config";
import { getIdToken } from "./auth";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const token = await getIdToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
  };
  const res = await fetch(`${config.apiBaseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  return schema.parse(await res.json());
}

export const api = {
  search(params: { q?: string; tags?: string[]; cursor?: string | null }) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.tags?.length) qs.set("tags", params.tags.join(","));
    if (params.cursor) qs.set("cursor", params.cursor);
    return request(`/v1/products?${qs}`, SearchResponse);
  },
  product(id: string) {
    return request(`/v1/products/${id}`, ProductDetail);
  },
  createProduct(input: CreateProductInput) {
    return request("/v1/products", CreateProductResponse, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createOrder(input: CreateOrderInput, idempotencyKey: string) {
    return request("/v1/orders", CreateOrderResponse, {
      method: "POST",
      body: JSON.stringify(input),
      idempotencyKey,
    });
  },
  order(id: string) {
    return request(`/v1/orders/${id}`, OrderView);
  },
  /** Local only: the API confirms the order itself when it runs without Razorpay keys. */
  async devPay(orderId: string) {
    const token = await getIdToken();
    const res = await fetch(`${config.apiBaseUrl}/v1/dev/orders/${orderId}/pay`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
  },
};

export { ApiError };
