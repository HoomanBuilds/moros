import type { PrivatePaymentRequest } from "./private-profile";

export type PaymentRequestDisplayStatus = "active" | "expired" | "cancelled" | "paid";

export function paymentRequestDisplayStatus(
  request: PrivatePaymentRequest,
  now = Math.floor(Date.now() / 1000),
): PaymentRequestDisplayStatus {
  if (request.status !== "active") return request.status;
  return request.expiresAt <= now ? "expired" : "active";
}

export function paymentRequestAmount(request: PrivatePaymentRequest): string {
  if (!request.amountAtomic) return "Open amount";
  const negative = request.amountAtomic.startsWith("-");
  const digits = negative ? request.amountAtomic.slice(1) : request.amountAtomic;
  const padded = digits.padStart(8, "0");
  const whole = padded.slice(0, -7);
  const fraction = padded.slice(-7).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""} USDC`;
}
