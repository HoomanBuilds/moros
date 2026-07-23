import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATOMIC_SCALE,
  FIXED_SCALE,
  allocateBatch,
  burnFundingShares,
  deriveLiquidityParameter,
  fillExit,
  initialLossAtomic,
  mintFundingShares,
  scenarioEquity,
  splitVestedFee,
  terminalRedeem,
} from "./model.mjs";

const lot = FIXED_SCALE;

const baseBatch = {
  qYes: 0n,
  qNo: 0n,
  b: 20n * FIXED_SCALE,
  lot,
  yesCount: 4n,
  noCount: 4n,
  feeRateBps: 400n,
};

const balanced = allocateBatch(baseBatch);
assert.equal(balanced.batchSize, 8n);
assert.equal(balanced.yesPrice + balanced.noPrice, FIXED_SCALE);
assert.equal(
  balanced.yesMarketCost + balanced.noMarketCost,
  balanced.aggregateMarketCharge,
);
assert.equal(
  balanced.yesCount * balanced.yesChargePerPosition
    + balanced.noCount * balanced.noChargePerPosition
    + balanced.roundingContribution,
  balanced.aggregateMarketCharge,
);
assert.ok(balanced.roundingContribution >= 0n);
assert.ok(balanced.roundingContribution < balanced.batchSize);
assert.equal(
  balanced.feeEscrow,
  balanced.batchSize * balanced.feePerPosition,
);
assert.ok(balanced.feeEscrow >= balanced.roundingContribution);

const reordered = allocateBatch({ ...baseBatch, inputOrder: ["n", "y", "n", "y"] });
assert.deepEqual(reordered, balanced);

for (const q of [-80n, -20n, 0n, 20n, 80n]) {
  for (let yes = 2n; yes <= 30n; yes += 1n) {
    for (let no = 2n; no <= 30n; no += 1n) {
      if (yes + no < 8n) continue;
      const quote = allocateBatch({
        ...baseBatch,
        qYes: q > 0n ? q * FIXED_SCALE : 0n,
        qNo: q < 0n ? -q * FIXED_SCALE : 0n,
        yesCount: yes,
        noCount: no,
      });
      assert.equal(
        quote.yesMarketCost + quote.noMarketCost,
        quote.aggregateMarketCharge,
      );
      assert.equal(
        yes * quote.yesChargePerPosition
          + no * quote.noChargePerPosition
          + quote.roundingContribution,
        quote.aggregateMarketCharge,
      );
      assert.ok(quote.roundingContribution >= 0n);
      assert.ok(quote.roundingContribution < quote.batchSize);
      assert.equal(quote.yesPrice + quote.noPrice, FIXED_SCALE);
      assert.ok(quote.feeEscrow >= quote.roundingContribution);
    }
  }
}

const shallow = allocateBatch({ ...baseBatch, b: 10n * FIXED_SCALE, yesCount: 6n, noCount: 2n });
const deep = allocateBatch({ ...baseBatch, b: 100n * FIXED_SCALE, yesCount: 6n, noCount: 2n });
assert.ok(shallow.postYesPrice - shallow.preYesPrice > deep.postYesPrice - deep.preYesPrice);

const target = 138_629_437n;
const liquidity = deriveLiquidityParameter(target, 0n);
assert.ok(liquidity.b > 0n);
assert.ok(initialLossAtomic(liquidity.b) <= target);
assert.ok(initialLossAtomic(liquidity.b + 1n) > target);

const virtual = 1_000_000n;
const firstShares = mintFundingShares({
  deposit: 5_000_000n,
  fundedAssets: 0n,
  totalShares: 0n,
  virtualAssets: virtual,
  virtualShares: virtual,
});
assert.equal(firstShares, 5_000_000n);

const secondShares = mintFundingShares({
  deposit: 2_500_000n,
  fundedAssets: 5_000_000n,
  totalShares: 5_000_000n,
  virtualAssets: virtual,
  virtualShares: virtual,
});
assert.equal(secondShares, 2_500_000n);
assert.equal(
  burnFundingShares({
    shares: 2_500_000n,
    fundedAssets: 7_500_000n,
    totalShares: 7_500_000n,
  }),
  2_500_000n,
);
assert.equal(
  burnFundingShares({
    shares: 5_000_000n,
    fundedAssets: 5_000_001n,
    totalShares: 5_000_000n,
  }),
  5_000_001n,
);

const equity = scenarioEquity({
  marketAssets: 20_000_000n,
  yesLiability: 13_000_000n,
  noLiability: 9_000_000n,
  conditionalLpFee: 1_000_000n,
});
assert.deepEqual(equity, {
  ifYes: 8_000_000n,
  ifNo: 12_000_000n,
  floor: 8_000_000n,
  ceiling: 12_000_000n,
});
assert.throws(() => scenarioEquity({
  marketAssets: 1n,
  yesLiability: 2n,
  noLiability: 0n,
  conditionalLpFee: 0n,
}));

const fees = splitVestedFee({
  feeEscrow: 101n,
  roundingReimbursement: 1n,
  lpSplitBps: 5_000n,
});
assert.deepEqual(fees, {
  roundingReimbursement: 1n,
  distributable: 100n,
  lpFee: 50n,
  protocolFee: 50n,
});
assert.throws(() => splitVestedFee({
  feeEscrow: 0n,
  roundingReimbursement: 1n,
  lpSplitBps: 5_000n,
}));

assert.deepEqual(fillExit({
  sharesRemaining: 100n,
  sharesRequested: 40n,
  minimumTotalPayment: 800n,
  payment: 320n,
}), {
  sharesTransferred: 40n,
  sharesRemaining: 60n,
  sellerPayment: 320n,
});
assert.throws(() => fillExit({
  sharesRemaining: 100n,
  sharesRequested: 40n,
  minimumTotalPayment: 801n,
  payment: 320n,
}));

assert.equal(terminalRedeem({
  shares: 25n,
  remainingAssets: 101n,
  remainingShares: 100n,
}), 25n);
assert.equal(terminalRedeem({
  shares: 75n,
  remainingAssets: 76n,
  remainingShares: 75n,
}), 76n);

const balancedCompleteSetCost =
  balanced.yesChargePerPosition * balanced.yesCount
  + balanced.noChargePerPosition * balanced.noCount
  + balanced.roundingContribution
  + balanced.feeEscrow;
assert.ok(
  balancedCompleteSetCost
    >= (balanced.yesCount < balanced.noCount ? balanced.yesCount : balanced.noCount)
      * ATOMIC_SCALE,
);

const fixture = JSON.parse(readFileSync(
  new URL("../../fixtures/economics/core.json", import.meta.url),
  "utf8",
));
const stringifyBigInts = (value) => JSON.parse(JSON.stringify(
  value,
  (_, item) => typeof item === "bigint" ? item.toString() : item,
));
for (const batch of fixture.batches) {
  const input = Object.fromEntries(
    Object.entries(batch.input).map(([key, value]) => [key, BigInt(value)]),
  );
  assert.deepEqual(stringifyBigInts(allocateBatch(input)), batch.output);
}
assert.deepEqual(
  stringifyBigInts(deriveLiquidityParameter(
    BigInt(fixture.liquidity.input.targetAtomic),
    BigInt(fixture.liquidity.input.initializationReserveAtomic),
  )),
  fixture.liquidity.output,
);

console.log("economics model ok");
