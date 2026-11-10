import assert from "node:assert/strict";
import { once } from "node:events";
import { createStellarRpcServer } from "./stellar-rpc-server.mjs";

let calls = [];
const server = createStellarRpcServer({
  rpcUrls: ["https://primary.example", "https://backup.example"],
  origins: new Set(["https://moros.fun", "https://pay.moros.fun"]),
  fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sequence: 123 } }), {
      status: url === "https://primary.example" ? 429 : 200,
    });
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" });
try {
  for (const path of ["/private/health", "/private/catalog", "/private/relay", "/zk/private/manifest.json", "/health"]) {
    assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + path, { method: "POST", body })).status, 404);
  }
  assert.equal(calls.length, 0);
  assert.equal((await fetch(base + "/stellar/rpc")).status, 405);
  assert.equal((await fetch(base + "/stellar/rpc", { method: "POST", body, headers: { origin: "https://evil.example" } })).status, 403);
  const options = await fetch(base + "/stellar/rpc", { method: "OPTIONS", headers: { origin: "https://moros.fun" } });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "https://moros.fun");
  assert.match(options.headers.get("access-control-allow-headers"), /x-client-version/);
  assert.equal((await fetch(base + "/stellar/rpc", { method: "POST", body: "bad json" })).status, 400);
  assert.equal((await fetch(base + "/stellar/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "unknown" }) })).status, 400);
  assert.equal((await fetch(base + "/stellar/rpc", { method: "POST", body: "x".repeat(256 * 1024 + 1) })).status, 413);
  assert.equal(calls.length, 0);
  const result = await fetch(base + "/stellar/rpc", { method: "POST", body, headers: { origin: "https://moros.fun" } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("access-control-allow-origin"), "https://moros.fun");
  assert.equal((await result.json()).result.sequence, 123);
  assert.deepEqual(calls.map((call) => call.url), ["https://primary.example", "https://backup.example"]);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

for (const limits of [{ clientLimit: 1 }, { globalLimit: 1 }]) {
  const limited = createStellarRpcServer({
    rpcUrls: ["https://limited.example"],
    ...limits,
    fetchImpl: async () => new Response("{}"),
  });
  limited.listen(0, "127.0.0.1");
  await once(limited, "listening");
  const url = `http://127.0.0.1:${limited.address().port}/stellar/rpc`;
  try {
    assert.equal((await fetch(url, { method: "POST", body, headers: { "x-forwarded-for": "127.0.0.2" } })).status, 200);
    const result = await fetch(url, { method: "POST", body, headers: { "x-forwarded-for": limits.globalLimit ? "127.0.0.3" : "127.0.0.2" } });
    assert.equal(result.status, 429);
    assert.ok(Number(result.headers.get("retry-after")) > 0);
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
}
assert.throws(() => createStellarRpcServer({ rpcUrls: [] }));
console.log("standalone Stellar RPC server tests passed");
