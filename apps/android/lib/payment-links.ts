export type ParsedPaymentTarget = {
  kind: "code" | "request";
  payload: string;
};

const paymentCodePattern = /^moros_pay_[A-Za-z0-9_-]{24,2048}$/;
const paymentHost = "pay.moros.fun";

export function parsePaymentTarget(raw: string): ParsedPaymentTarget {
  const value = raw.trim();
  if (!value || value.length > 4096) throw new Error("Payment code is missing or too large.");
  if (paymentCodePattern.test(value)) return { kind: "code", payload: value };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("This is not a valid Moros payment code.");
  }

  const allowedHost = url.protocol === "https:" && url.hostname === paymentHost && url.pathname === "/pay";
  const allowedScheme = url.protocol === "moros:" && (url.hostname === "pay" || url.pathname === "pay");
  if (!allowedHost && !allowedScheme) throw new Error("This payment request belongs to another app.");

  const payload = url.hash.slice(1) || url.searchParams.get("request") || "";
  if (!payload || payload.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new Error("This Moros payment request is malformed.");
  }
  return { kind: "request", payload };
}
