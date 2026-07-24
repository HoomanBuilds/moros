import assert from "node:assert/strict";
import { marketReadPlan } from "./market-read-plan.ts";

assert.throws(
  () => marketReadPlan({
    marketId: "stale-market",
    poolId: "stale-pool",
  }),
  /current private deployment/,
);

const privateMarket = marketReadPlan({
  marketId: "private-market",
  poolId: "shared-private-vault",
  liquidityVaultId: "isolated-liquidity-vault",
});
assert.deepEqual(privateMarket, {
  balanceOwner: "private-market",
  feeSource: "private-registration",
});

console.log("market read plan ok");
