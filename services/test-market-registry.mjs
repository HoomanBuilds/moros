import assert from "node:assert/strict";
import { syncPublicMarketState } from "./market-registry.mjs";

const proposalId = "a".repeat(64);
const poolId = `C${"A".repeat(55)}`;
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "secret",
};

assert.deepEqual(
  await syncPublicMarketState({
    proposalId,
    state: "active",
    poolId,
    env: {},
  }),
  { configured: false },
);

await assert.rejects(
  syncPublicMarketState({
    proposalId,
    state: "active",
    env: { SUPABASE_URL: env.SUPABASE_URL },
  }),
  /configuration is incomplete/,
);

let request;
const result = await syncPublicMarketState({
  proposalId,
  state: "active",
  poolId,
  env,
  fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify([{
      proposal_id: proposalId,
      market_id: `C${"B".repeat(55)}`,
      pool_id: poolId,
      market_state: "active",
    }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(result.configured, true);
assert.match(request.url, new RegExp(proposalId));
assert.equal(request.options.method, "PATCH");
assert.equal(request.options.headers.prefer, "return=representation");

await assert.rejects(
  syncPublicMarketState({
    proposalId,
    state: "cancelled",
    env,
    fetchImpl: async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  }),
  /fresh public market registry record was not updated/,
);

await assert.rejects(
  syncPublicMarketState({
    proposalId,
    state: "active",
    poolId,
    env,
    fetchImpl: async () => new Response("failed", { status: 500 }),
  }),
  /HTTP 500/,
);

console.log("market registry sync ok");
