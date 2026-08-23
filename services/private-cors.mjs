const ALLOWED_REQUEST_HEADERS =
  "content-type, x-client-name, x-client-version";
const EXPOSED_RESPONSE_HEADERS =
  "retry-after, x-ratelimit-reset";

export const DEFAULT_PRIVATE_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3010",
  "https://moros.fun",
  "https://www.moros.fun",
  "https://predict.moros.fun",
  "https://pay.moros.fun",
  "https://moros-six.vercel.app",
];

export function privateAllowedOrigins(value) {
  return new Set(
    (value ? value.split(",") : DEFAULT_PRIVATE_ORIGINS)
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(origin).origin),
  );
}

export function privateResponseHeaders(request, allowedOrigins) {
  const origin = request.headers.origin;
  return origin && allowedOrigins.has(origin)
    ? {
        "access-control-allow-headers": ALLOWED_REQUEST_HEADERS,
        "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
        "access-control-allow-origin": origin,
        "access-control-expose-headers": EXPOSED_RESPONSE_HEADERS,
        vary: "origin",
      }
    : {};
}
