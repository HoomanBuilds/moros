import assert from "node:assert/strict";
import { PaymentApiError, PaymentHttpClient } from "../src/http.mjs";

function response(status, value, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers });
}

const originalFetch = globalThis.fetch;
let defaultFetchReceiver;
globalThis.fetch = function () {
  defaultFetchReceiver = this;
  return Promise.resolve(response(200, { ok: true }));
};
try {
  const defaultClient = new PaymentHttpClient({ endpoints: ["https://one.example"] });
  assert.deepEqual(await defaultClient.request("/v1/health"), { ok: true });
  assert.equal(defaultFetchReceiver, globalThis);
} finally {
  globalThis.fetch = originalFetch;
}

let now = 1_000;
const calls = [];
const client = new PaymentHttpClient({
  endpoints: ["https://one.example", "https://two.example"],
  now: () => now,
  attempts: 1,
  fetchImpl: async (url, options) => {
    calls.push([url, options]);
    if (url.startsWith("https://one.example")) return response(503, { error: "busy" });
    return response(200, { ok: true });
  },
});
assert.deepEqual(await client.request("/v1/health"), { ok: true });
assert.equal(calls.length, 2);
calls.length = 0;
now += 100;
assert.deepEqual(await client.request("/v1/health"), { ok: true });
assert.equal(calls[0][0].startsWith("https://two.example"), true);

let rejectedCalls = 0;
const rejected = new PaymentHttpClient({
  endpoints: ["https://one.example", "https://two.example"],
  fetchImpl: async () => {
    rejectedCalls++;
    return response(400, { error: "bad proof" });
  },
});
await assert.rejects(rejected.request("/v1/relay/submit"), (error) => {
  assert.equal(error instanceof PaymentApiError, true);
  assert.equal(error.status, 400);
  assert.equal(error.retryable, false);
  return true;
});
assert.equal(rejectedCalls, 1);

const failed = new PaymentHttpClient({
  endpoints: ["https://one.example"],
  attempts: 2,
  fetchImpl: async () => {
    throw new Error("offline");
  },
});
await assert.rejects(failed.request("/v1/health"), /all payment API endpoints failed/);

const oversized = new PaymentHttpClient({
  endpoints: ["https://one.example"],
  fetchImpl: async () => response(200, {}, { "content-length": "3000000" }),
});
await assert.rejects(oversized.request("/v1/health"), /response is too large/);
await assert.rejects(client.request("//evil.example/path"), /invalid payment API path/);

const controller = new AbortController();
controller.abort(new Error("user cancelled"));
await assert.rejects(client.request("/v1/health", { signal: controller.signal }), /user cancelled/);

process.stdout.write("payment HTTP client tests passed\n");
