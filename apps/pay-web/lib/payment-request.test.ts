import assert from "node:assert/strict";
import { paymentRequestAmount, paymentRequestDisplayStatus } from "./payment-request";

const request = {
  requestId: "request-1",
  paymentLink: "https://pay.moros.fun/pay#request",
  recipientFingerprint: "1234-5678-90AB",
  amountAtomic: "125000000",
  createdAt: 100,
  expiresAt: 200,
  updatedAt: 100_000,
  status: "active" as const,
};

assert.equal(paymentRequestDisplayStatus(request, 199), "active");
assert.equal(paymentRequestDisplayStatus(request, 200), "expired");
assert.equal(paymentRequestDisplayStatus({ ...request, status: "cancelled" }, 150), "cancelled");
assert.equal(paymentRequestAmount(request), "12.5 USDC");
assert.equal(paymentRequestAmount({ ...request, amountAtomic: "1" }), "0.0000001 USDC");
assert.equal(paymentRequestAmount({ ...request, amountAtomic: undefined }), "Open amount");

process.stdout.write("payment request tests passed\n");
