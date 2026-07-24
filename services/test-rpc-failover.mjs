import assert from "node:assert/strict";
import http from "node:http";
import { startRpcFailover } from "./rpc-failover.mjs";

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

const primary = await listen((_request, response) => {
  response.writeHead(503).end();
});
let fallbackRequests = 0;
const fallback = await listen(async (request, response) => {
  for await (const _chunk of request) {}
  fallbackRequests += 1;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 42 }));
});
const proxy = await startRpcFailover({
  id: "mainnet",
  rpcUrls: [primary.url, fallback.url],
});
const result = await fetch(proxy, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "test" }),
});
assert.equal(result.status, 200);
assert.equal((await result.json()).result, 42);
assert.equal(fallbackRequests, 1);
assert.equal(
  await startRpcFailover({
    id: "testnet",
    rpcUrls: ["https://single.example"],
  }),
  "https://single.example",
);
primary.server.close();
fallback.server.close();

console.log("RPC failover ok");
