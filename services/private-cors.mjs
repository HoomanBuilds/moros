const ALLOWED_REQUEST_HEADERS =
  "content-type, x-client-name, x-client-version";
const EXPOSED_RESPONSE_HEADERS =
  "retry-after, x-ratelimit-reset";

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
