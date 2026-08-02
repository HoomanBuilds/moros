import assert from "node:assert/strict";
import { rpcFetch } from "./rpc-failover.mjs";

const calls = [];
const response = await rpcFetch(
  ["https://primary.example", "https://fallback.example"],
  "https://primary.example",
  { method: "POST", body: "{}" },
  async (url) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({ result: calls.length }),
      {
        status: calls.length === 1 ? 503 : 200,
        headers: { "content-type": "application/json" },
      },
    );
  },
);
assert.equal(response.status, 200);
assert.deepEqual(calls, [
  "https://primary.example",
  "https://fallback.example",
]);
const rateLimitedCalls = [];
const rateLimitedResponse = await rpcFetch(
  [
    "https://primary.example",
    "https://fallback.example",
    "https://public.example",
  ],
  "https://primary.example",
  { method: "POST", body: "{}" },
  async (url) => {
    rateLimitedCalls.push(String(url));
    return new Response("{}", {
      status: rateLimitedCalls.length < 3 ? 429 : 200,
    });
  },
);
assert.equal(rateLimitedResponse.status, 200);
assert.deepEqual(rateLimitedCalls, [
  "https://primary.example",
  "https://fallback.example",
  "https://public.example",
]);
assert.equal(
  (
    await rpcFetch(
      ["https://primary.example", "https://fallback.example"],
      "https://other.example",
      undefined,
      async (url) => new Response(String(url)),
    )
  ).status,
  200,
);

const timeoutCalls = [];
const timeoutResponse = await rpcFetch(
  ["https://slow.example", "https://healthy.example"],
  "https://slow.example",
  { method: "POST", body: "{}" },
  async (url, init) => {
    timeoutCalls.push(String(url));
    if (String(url) === "https://healthy.example") {
      return new Response("{}", { status: 200 });
    }
    return new Promise((resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  },
  { attemptTimeoutMs: 5 },
);
assert.equal(timeoutResponse.status, 200);
assert.deepEqual(timeoutCalls, [
  "https://slow.example",
  "https://healthy.example",
]);

const caller = new AbortController();
caller.abort(new Error("request cancelled"));
await assert.rejects(
  rpcFetch(
    ["https://primary.example", "https://fallback.example"],
    "https://primary.example",
    { method: "POST", body: "{}", signal: caller.signal },
    async () => new Response("{}", { status: 200 }),
  ),
  /request cancelled/u,
);
await assert.rejects(
  rpcFetch(
    ["https://primary.example"],
    "https://primary.example",
    undefined,
    async () => new Response("{}", { status: 200 }),
    { attemptTimeoutMs: 0 },
  ),
  /positive integer/u,
);

console.log("RPC failover ok");
