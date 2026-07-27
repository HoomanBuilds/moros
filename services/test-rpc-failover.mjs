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

console.log("RPC failover ok");
