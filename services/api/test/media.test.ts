import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";

const { productIdFromRawObject, rawObjectName } = await import("../src/media.js");
const { verifyWebhookSignature } = await import("../src/payments.js");

describe("raw object naming", () => {
  it("round-trips the product id", () => {
    const id = "3f2b9c1e-8a4d-4c1b-9e2f-1a2b3c4d5e6f";
    const name = rawObjectName(id, "my pot (final).mp4");
    expect(name.startsWith(`raw/${id}/`)).toBe(true);
    expect(name).not.toMatch(/[ ()]/);
    expect(productIdFromRawObject(name)).toBe(id);
  });

  it("ignores objects outside raw/", () => {
    expect(productIdFromRawObject("tmp/abc.mp4")).toBeNull();
  });
});

describe("razorpay webhook signature", () => {
  const body = Buffer.from(JSON.stringify({ event: "payment.captured" }));
  const sig = createHmac("sha256", "whsec_test").update(body).digest("hex");

  it("accepts a valid signature", () => expect(verifyWebhookSignature(body, sig)).toBe(true));
  it("rejects a tampered body", () => expect(verifyWebhookSignature(Buffer.from("{}"), sig)).toBe(false));
  it("rejects a missing signature", () => expect(verifyWebhookSignature(body, undefined)).toBe(false));
});
