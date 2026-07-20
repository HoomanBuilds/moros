import assert from "node:assert";
import { LMSR_B, MARKET_SUBSIDY } from "./deploy-constants.ts";

const shareScale = 1n << 32n;
const collateralScale = 10_000_000n;
const expectedSubsidy = BigInt(Math.ceil(20 * Math.log(2) * Number(collateralScale)));

assert.equal(BigInt(LMSR_B), 20n * shareScale);
assert.equal(BigInt(MARKET_SUBSIDY), expectedSubsidy);
assert.ok(BigInt(MARKET_SUBSIDY) < 20n * collateralScale);

console.log("deployment economics ok");
