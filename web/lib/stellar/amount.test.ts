import assert from "node:assert";
import {
  formatTokenAmount,
  parseBalanceAmount,
  parsePrivatePositionQuantity,
  parseTokenAmount,
  parseWholeOrderAmount,
  privacyStakeForOrder,
} from "./amount.ts";

assert.equal(parseTokenAmount("1", 7), 10_000_000n);
assert.equal(parseTokenAmount("1.25", 7), 12_500_000n);
assert.equal(parseTokenAmount("0.0000001", 7), 1n);
assert.equal(parseBalanceAmount("0.0000000", 7), 0n);
assert.equal(formatTokenAmount(12_500_000n, 7), "1.25");
assert.equal(formatTokenAmount(10_000_000n, 7), "1");
assert.deepEqual(parseWholeOrderAmount("10", 7), { orderAmount: "10", atomic: 100_000_000n });
assert.deepEqual(privacyStakeForOrder("2", 7), { orderAmount: "2", stakeAmount: "5", stakeAtomic: 50_000_000n });
assert.deepEqual(privacyStakeForOrder("25", 7), { orderAmount: "25", stakeAmount: "25", stakeAtomic: 250_000_000n });
assert.equal(parsePrivatePositionQuantity("1"), 1n);
assert.equal(parsePrivatePositionQuantity("1000"), 1_000n);
assert.throws(() => parseTokenAmount("1.00000001", 7), /at most 7/);
assert.throws(() => parseTokenAmount("0", 7), /greater than zero/);
assert.throws(() => parseWholeOrderAmount("1.5", 7), /whole collateral units/);
assert.throws(() => parsePrivatePositionQuantity("0"), /between 1 and 1,000/);
assert.throws(() => parsePrivatePositionQuantity("1001"), /between 1 and 1,000/);
assert.throws(() => parsePrivatePositionQuantity("1.5"), /whole number/);
assert.throws(() => privacyStakeForOrder("1001", 7), /up to 1,000/);

console.log("token amounts ok");
