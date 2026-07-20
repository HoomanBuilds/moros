import assert from "node:assert/strict";
import { reflectorPriceToNumber, spotFromCandles } from "./asset-price";

assert.equal(reflectorPriceToNumber(100_000_000_000_000n), 1);
assert.equal(reflectorPriceToNumber(123_456_789_000_000n), 1.23456789);
assert.equal(reflectorPriceToNumber(6_428_215_942_364_941_173n), 64_282.15942364941);
assert.equal(reflectorPriceToNumber(-50_000_000_000_000n), -0.5);
assert.deepEqual(spotFromCandles([]), null);
assert.deepEqual(
  spotFromCandles([{ t: 1, price: 100 }, { t: 2, price: 125 }]),
  { price: 125, changePct: 25 },
);

console.log("asset prices ok");
