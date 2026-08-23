const MAX_JSON_BYTES = 1_500_000;
const MAX_SYNC_PAGE_BASE64 = 5_700;

function strictObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid ${label}`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function integer(value, minimum, maximum, label) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return parsed;
}

function hex(value, bytes, label) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return Buffer.from(value, "hex");
}

function base64(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`invalid ${label}`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`invalid ${label}`);
  return decoded;
}

function base64url(value, bytes, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value) {
    throw new Error(`invalid ${label}`);
  }
  return decoded;
}

function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function responseHeaders(origin) {
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "false";
    headers.vary = "origin";
  }
  return headers;
}

function json(status, value, origin) {
  return new Response(JSON.stringify(jsonValue(value)), {
    status,
    headers: responseHeaders(origin),
  });
}

function errorResponse(error, origin) {
  const detail = error?.message || "invalid payment request";
  if (
    detail.includes("database timed out") ||
    detail.includes("database is unavailable") ||
    detail.includes("database failed with HTTP 429") ||
    detail.includes("database failed with HTTP 5") ||
    detail.includes("service temporarily unavailable")
  ) {
    return json(503, { error: "payment service temporarily unavailable" }, origin);
  }
  return json(400, { error: detail }, origin);
}

async function body(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("content type must be application/json");
  }
  const length = request.headers.get("content-length");
  if (length && integer(length, 0, MAX_JSON_BYTES, "request size") > MAX_JSON_BYTES) {
    throw new Error("request is too large");
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error("request is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON request");
  }
}

function bearer(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 300) {
    throw new Error("sync authentication is required");
  }
  return authorization.slice(7);
}

function pathActionId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) throw new Error("invalid payment action path");
  return hex(pathname.slice(prefix.length), 32, "payment action id").toString("hex");
}

export class PaymentApi {
  constructor({ relay, indexer, sync, allowedOrigins = [] }) {
    if (!relay || !indexer || !sync) throw new Error("payment API services are required");
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length > 16) {
      throw new Error("invalid payment API origins");
    }
    this.relay = relay;
    this.indexer = indexer;
    this.sync = sync;
    this.allowedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  }

  async handle(request) {
    const origin = request.headers.get("origin");
    if (origin && !this.allowedOrigins.has(origin)) {
      return json(403, { error: "origin is not allowed" }, null);
    }
    if (request.method === "OPTIONS") {
      const headers = responseHeaders(origin);
      headers["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
      headers["access-control-allow-headers"] = "authorization, content-type";
      headers["access-control-max-age"] = "600";
      return new Response(null, { status: 204, headers });
    }
    try {
      return await this.route(request, origin);
    } catch (error) {
      return errorResponse(error, origin);
    }
  }

  async route(request, origin) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === "GET" && pathname === "/v1/health") {
      return json(200, { status: "ok", index: this.indexer.summary() }, origin);
    }
    if (request.method === "POST" && pathname === "/v1/relay/quote") {
      const input = strictObject(await body(request), ["actionExpiry", "actionId"], "relay quote request");
      const quote = this.relay.issueQuote({
        actionId: hex(input.actionId, 32, "action id"),
        actionExpiry: integer(input.actionExpiry, 1, Number.MAX_SAFE_INTEGER, "action expiry"),
      });
      return json(200, {
        xdr: quote.xdr,
        quoteId: quote.quoteId.toString("hex"),
        signingKey: quote.signingKey.toString("hex"),
        paymentIdentity: quote.paymentIdentity,
        fee: quote.fee,
        expiry: quote.expiry,
      }, origin);
    }
    if (request.method === "POST" && pathname === "/v1/relay/submit") {
      const input = strictObject(await body(request), ["args", "contract", "method"], "relay submission");
      return json(200, await this.relay.relay(input), origin);
    }
    if (request.method === "GET" && pathname === "/v1/outputs") {
      return json(200, this.indexer.outputs({
        fromLeafIndex: integer(url.searchParams.get("from") || "0", 0, 2 ** 31 - 1, "output cursor"),
        limit: integer(url.searchParams.get("limit") || "100", 1, 500, "output limit"),
      }), origin);
    }
    if (request.method === "GET" && pathname.startsWith("/v1/attachments/")) {
      return json(200, { attachment: this.indexer.attachment(pathActionId(pathname, "/v1/attachments/")) }, origin);
    }
    if (request.method === "GET" && pathname.startsWith("/v1/actions/")) {
      return json(200, { action: this.indexer.action(pathActionId(pathname, "/v1/actions/")) }, origin);
    }
    if (request.method === "POST" && pathname === "/v1/sync/challenge") {
      const input = strictObject(await body(request), ["locator", "signingKey"], "sync challenge request");
      const issued = await this.sync.issueChallenge({
        locator: base64url(input.locator, 32, "archive locator"),
        signingKey: base64url(input.signingKey, 32, "archive signing key"),
      });
      return json(200, {
        challenge: issued.challenge.toString("base64url"),
        expiresAt: issued.expiresAt,
      }, origin);
    }
    if (request.method === "POST" && pathname === "/v1/sync/authenticate") {
      const input = strictObject(
        await body(request),
        ["challenge", "expiresAt", "locator", "signature", "signingKey"],
        "sync authentication request",
      );
      return json(200, await this.sync.authenticate({
        locator: base64url(input.locator, 32, "archive locator"),
        signingKey: base64url(input.signingKey, 32, "archive signing key"),
        challenge: base64url(input.challenge, 32, "sync challenge"),
        expiresAt: integer(input.expiresAt, 1, Number.MAX_SAFE_INTEGER, "sync challenge expiry"),
        signature: base64url(input.signature, 64, "sync signature"),
      }), origin);
    }
    if (request.method === "GET" && pathname === "/v1/sync/manifest") {
      return json(200, await this.sync.manifest(bearer(request)), origin);
    }
    if (request.method === "GET" && pathname === "/v1/sync/pages") {
      const generation = url.searchParams.has("generation")
        ? integer(url.searchParams.get("generation"), 1, Number.MAX_SAFE_INTEGER, "archive generation")
        : undefined;
      return json(200, await this.sync.pages(bearer(request), {
        generation,
        fromPage: integer(url.searchParams.get("from") || "0", 0, 256, "archive page cursor"),
        limit: integer(url.searchParams.get("limit") || "32", 1, 64, "archive page limit"),
      }), origin);
    }
    if (request.method === "PUT" && pathname === "/v1/sync/pages") {
      const input = strictObject(await body(request), ["page"], "archive page upload");
      return json(200, await this.sync.putPage(
        bearer(request),
        base64(input.page, MAX_SYNC_PAGE_BASE64, "encrypted archive page"),
      ), origin);
    }
    if (request.method === "PUT" && pathname === "/v1/sync/pages/batch") {
      const input = strictObject(await body(request), ["pages"], "archive page batch upload");
      if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.length > 64) {
        throw new Error("invalid archive page batch");
      }
      const pages = input.pages.map((page) => base64(page, MAX_SYNC_PAGE_BASE64, "encrypted archive page"));
      const token = bearer(request);
      const results = [];
      if (typeof this.sync.putPages === "function") {
        results.push(...await this.sync.putPages(token, pages));
      } else {
        for (const page of pages) results.push(await this.sync.putPage(token, page));
      }
      return json(200, { pages: results }, origin);
    }
    if (request.method === "POST" && pathname === "/v1/sync/commit") {
      const input = strictObject(
        await body(request),
        ["expectedParentHash", "generation", "headHash", "pageCount"],
        "archive commit",
      );
      return json(200, await this.sync.commitGeneration(bearer(request), {
        generation: integer(input.generation, 1, Number.MAX_SAFE_INTEGER, "archive generation"),
        pageCount: integer(input.pageCount, 1, 256, "archive page count"),
        headHash: hex(input.headHash, 32, "archive head hash"),
        expectedParentHash: hex(input.expectedParentHash, 32, "archive parent hash"),
      }), origin);
    }
    if (request.method === "DELETE" && pathname === "/v1/sync/generations") {
      const minimum = integer(url.searchParams.get("before"), 1, Number.MAX_SAFE_INTEGER, "minimum archive generation");
      return json(200, await this.sync.deleteGenerationsBefore(bearer(request), minimum), origin);
    }
    return json(404, { error: "payment route not found" }, origin);
  }
}
