import assert from "node:assert";
import { derivePositionLifecycle, estimateSettlement, parseOrderStatus } from "./state.ts";

const scale = 1n << 32n;
const winner = estimateSettlement({
  amount: "10",
  stakeAmount: "10",
  side: "1",
  outcome: "YES",
  priceYes: scale / 2n,
  feeBps: 200,
  decimals: 7,
});
assert.equal(winner.winner, true);
assert.equal(winner.payoutAtomic, 149_000_000n);
assert.equal(winner.feeAtomic, 999_999n);

const loser = estimateSettlement({
  amount: "10",
  stakeAmount: "25",
  side: "0",
  outcome: "YES",
  priceYes: scale / 2n,
  feeBps: 200,
  decimals: 7,
});
assert.equal(loser.winner, false);
assert.equal(loser.payoutAtomic, 200_000_000n);
assert.equal(loser.feeAtomic, 0n);

assert.deepEqual(derivePositionLifecycle({
  localStatus: "submitted",
  orderStatus: "Included",
  outcome: "YES",
  acceptingOrders: false,
  finalizable: true,
  winner: true,
  payoutAtomic: winner.payoutAtomic,
}), { lifecycle: "claim_winnings", action: "claim" });

assert.deepEqual(derivePositionLifecycle({
  localStatus: "submitted",
  orderStatus: "Included",
  outcome: "YES",
  acceptingOrders: false,
  finalizable: true,
  winner: false,
  payoutAtomic: loser.payoutAtomic,
}), { lifecycle: "recover_collateral", action: "recover" });

assert.deepEqual(derivePositionLifecycle({
  localStatus: "submitted",
  orderStatus: "Pending",
  outcome: "YES",
  acceptingOrders: false,
  finalizable: true,
}), { lifecycle: "full_refund", action: "refund" });

assert.equal(parseOrderStatus("Included"), "Included");
assert.equal(parseOrderStatus({ tag: "Pending" }), "Pending");
assert.equal(parseOrderStatus(["Refunded"]), "Refunded");
assert.equal(parseOrderStatus({ status: { tag: "Redeemed" } }), "Redeemed");
assert.equal(parseOrderStatus({ unknown: null }), null);

assert.deepEqual(derivePositionLifecycle({
  localStatus: "redeemed",
  orderStatus: "Included",
  outcome: "YES",
  acceptingOrders: false,
  finalizable: true,
  winner: true,
  payoutAtomic: winner.payoutAtomic,
}), { lifecycle: "claim_winnings", action: "claim" });

console.log("position state ok");
