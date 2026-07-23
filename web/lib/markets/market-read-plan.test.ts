import assert from "node:assert/strict";
import { marketReadPlan } from "./market-read-plan.ts";

const legacy = marketReadPlan({
  marketId: "legacy-market",
  poolId: "legacy-pool",
});
assert.deepEqual(legacy, {
  balanceOwner: "legacy-pool",
  feeSource: "legacy-pool",
});

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
