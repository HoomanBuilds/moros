const DEFAULT_BRAND_URL = "https://moros.fun";
const DEFAULT_PAY_URL = "https://pay.moros.fun";
const DEFAULT_PREDICT_URL = "https://predict.moros.fun";

export function normalizeProductUrl(value: string | undefined, fallback: string): string {
  try {
    const url = new URL(value || fallback);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("Public product URLs must use HTTPS.");
    }
    return url.origin;
  } catch {
    return fallback;
  }
}

export const productUrls = Object.freeze({
  brand: normalizeProductUrl(process.env.NEXT_PUBLIC_BRAND_URL, DEFAULT_BRAND_URL),
  pay: normalizeProductUrl(process.env.NEXT_PUBLIC_PAY_URL, DEFAULT_PAY_URL),
  predict: normalizeProductUrl(process.env.NEXT_PUBLIC_PREDICT_URL, DEFAULT_PREDICT_URL),
});
