import { productUrls } from "./product-urls";

const legacyHosts = new Set(["moros.fun", "www.moros.fun"]);

export function legacyPredictRedirectEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function requestHostname(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return new URL(`https://${value.split(",", 1)[0].trim()}`).hostname.toLowerCase();
  } catch {
    return fallback;
  }
}

export function legacyPredictDestination(
  input: string,
  forwardedHost?: string | null,
): string | null {
  const url = new URL(input);
  const isAppRoute = url.pathname === "/app" || url.pathname.startsWith("/app/");
  const hostname = requestHostname(forwardedHost, url.hostname.toLowerCase());
  if (!legacyHosts.has(hostname) || !isAppRoute) return null;
  return `${productUrls.predict}${url.pathname}${url.search}`;
}
