import http from "node:http";
import { fileURLToPath } from "node:url";
import { allowedWebOrigins, responseCorsHeaders } from "./http-cors.mjs";
import { FixedWindowRateLimiter } from "./rate-limit.mjs";
import { rpcFetch } from "./rpc-failover.mjs";
import { isAllowedStellarRpcRequest } from "./stellar-rpc-proxy.mjs";

export function createStellarRpcServer({
  rpcUrls,
  origins = allowedWebOrigins(process.env.PUBLIC_ORIGINS),
  clientLimit = 600,
  globalLimit = 1200,
  fetchImpl = globalThis.fetch,
}) {
  if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) throw new Error("Stellar RPC providers are required");
  const clients = new FixedWindowRateLimiter({ limit: clientLimit, windowMs: 60_000 });
  const global = new FixedWindowRateLimiter({ limit: globalLimit, windowMs: 60_000 });

  return http.createServer(async (request, response) => {
    const headers = responseCorsHeaders(request, origins);
    function json(status, value, extra = {}) {
      const body = JSON.stringify(value);
      response.writeHead(status, {
        ...headers,
        ...extra,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
      });
      response.end(body);
    }

    try {
      const path = new URL(request.url || "/", "http://localhost").pathname;
      if (path !== "/stellar/rpc") return json(404, { error: "not found" });
      if (request.headers.origin && !origins.has(request.headers.origin)) {
        return json(403, { error: "origin is not allowed" });
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, headers);
        response.end();
        return;
      }
      if (request.method !== "POST") return json(405, { error: "method not allowed" }, { allow: "POST, OPTIONS" });

      const forwarded = request.headers["x-forwarded-for"];
      const client = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim()
        || request.socket.remoteAddress || "unknown";
      const clientRate = clients.take(client);
      const globalRate = clientRate.allowed ? global.take("rpc") : null;
      if (!clientRate.allowed || !globalRate?.allowed) {
        const reset = clientRate.allowed ? globalRate.resetAt : clientRate.resetAt;
        return json(429, { error: "rate limit exceeded" }, {
          "retry-after": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
          "x-ratelimit-reset": String(Math.ceil(reset / 1000)),
        });
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 256 * 1024) return json(413, { error: "request body is too large" });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return json(400, { error: "request body is not valid JSON" });
      }
      if (!isAllowedStellarRpcRequest(body)) return json(400, { error: "unsupported Stellar RPC request" });

      const upstream = await rpcFetch(rpcUrls, rpcUrls[0], {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      }, fetchImpl);
      const payload = await upstream.text();
      response.writeHead(upstream.status, {
        ...headers,
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        ...(upstream.headers.has("retry-after") ? { "retry-after": upstream.headers.get("retry-after") } : {}),
      });
      response.end(payload);
    } catch {
      json(503, { error: "Stellar RPC is temporarily unavailable" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { networkConfig } = await import("./network-config.mjs");
  const network = networkConfig();
  const port = Number(process.env.STELLAR_RPC_PORT || 8788);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid Stellar RPC port");
  createStellarRpcServer({
    rpcUrls: network.rpcUrls,
    clientLimit: Number(process.env.STELLAR_RPC_CLIENT_LIMIT || 600),
    globalLimit: Number(process.env.STELLAR_RPC_GLOBAL_LIMIT || 1200),
  }).listen(port, "127.0.0.1", () => {
    process.stdout.write(`Moros Stellar RPC listening on ${port}\n`);
  });
}
