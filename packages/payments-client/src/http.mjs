const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_ATTEMPTS = 3;

function defaultFetch(...args) {
  return globalThis.fetch(...args);
}

export class PaymentApiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "PaymentApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

function normalizePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("invalid payment API path");
  }
  return path;
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function responseJson(response) {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    throw new PaymentApiError("payment API response is too large", { retryable: true });
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) {
    throw new PaymentApiError("payment API response is too large", { retryable: true });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PaymentApiError("payment API returned invalid JSON", { retryable: true });
  }
}

export class PaymentHttpClient {
  constructor({ endpoints, fetchImpl = defaultFetch, timeoutMs = 8_000, attempts = 2, now = Date.now }) {
    if (!Array.isArray(endpoints) || endpoints.length === 0 || endpoints.length > 4) {
      throw new Error("invalid payment API endpoints");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
      throw new Error("invalid payment API timeout");
    }
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
      throw new Error("invalid payment API attempts");
    }
    this.endpoints = endpoints;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
    this.now = now;
    this.health = new Map(endpoints.map((endpoint) => [endpoint, { failures: 0, retryAt: 0, lastSuccess: 0 }]));
  }

  rankedEndpoints() {
    const now = this.now();
    return [...this.endpoints].sort((left, right) => {
      const a = this.health.get(left);
      const b = this.health.get(right);
      const aBlocked = a.retryAt > now;
      const bBlocked = b.retryAt > now;
      if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
      if (a.lastSuccess !== b.lastSuccess) return b.lastSuccess - a.lastSuccess;
      return this.endpoints.indexOf(left) - this.endpoints.indexOf(right);
    });
  }

  async request(path, { method = "GET", body, token, signal } = {}) {
    const normalizedPath = normalizePath(path);
    if (signal?.aborted) throw signal.reason || new Error("payment request aborted");
    let lastError;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      for (const endpoint of this.rankedEndpoints()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("payment API timeout")), this.timeoutMs);
        const onAbort = () => controller.abort(signal.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const headers = { accept: "application/json" };
          if (body !== undefined) headers["content-type"] = "application/json";
          if (token) headers.authorization = `Bearer ${token}`;
          const response = await this.fetchImpl(`${endpoint}${normalizedPath}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });
          const payload = await responseJson(response);
          if (!response.ok) {
            throw new PaymentApiError(
              typeof payload?.error === "string" ? payload.error : `payment API failed with ${response.status}`,
              { status: response.status, retryable: retryableStatus(response.status) },
            );
          }
          this.health.set(endpoint, { failures: 0, retryAt: 0, lastSuccess: this.now() });
          return payload;
        } catch (error) {
          if (signal?.aborted) throw signal.reason || error;
          if (error instanceof PaymentApiError && !error.retryable) throw error;
          const current = this.health.get(endpoint);
          const failures = Math.min(current.failures + 1, 6);
          this.health.set(endpoint, {
            ...current,
            failures,
            retryAt: this.now() + Math.min(60_000, 1_000 * 2 ** failures),
          });
          lastError = error;
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
        }
      }
    }
    throw new PaymentApiError(`all payment API endpoints failed: ${lastError?.message || "unknown error"}`, {
      retryable: true,
    });
  }
}
