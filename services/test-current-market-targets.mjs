import assert from "node:assert/strict";
import { StrKey } from "@stellar/stellar-sdk";
import { currentMarketTargets } from "./current-market-targets.mjs";

const contract = (byte) =>
  StrKey.encodeContract(Buffer.alloc(32, byte));
const deployment = {
  contracts: {
    factory: contract(1),
    sharedVault: contract(2),
  },
};
const collateral = contract(3);
const current = {
  market_id: contract(4),
  pool_id: deployment.contracts.sharedVault,
  liquidity_vault_id: contract(5),
  proposal_id: "a".repeat(64),
  factory_id: deployment.contracts.factory,
  market_state: "active",
  resolver_type: "price",
  collateral_sac: collateral,
};

assert.deepEqual(
  currentMarketTargets([current], deployment, collateral),
  [{
    marketId: current.market_id,
    poolId: current.pool_id,
    liquidityVaultId: current.liquidity_vault_id,
  }],
);
for (const stale of [
  { ...current, market_state: "funding" },
  { ...current, factory_id: contract(6) },
  { ...current, pool_id: contract(7) },
  { ...current, proposal_id: null },
  { ...current, liquidity_vault_id: null },
  { ...current, resolver_type: "event" },
  { ...current, collateral_sac: contract(8) },
]) {
  assert.deepEqual(currentMarketTargets([stale], deployment, collateral), []);
}
assert.throws(
  () => currentMarketTargets(null, deployment, collateral),
  /response is invalid/,
);

process.stdout.write("current keeper market filter ok\n");
