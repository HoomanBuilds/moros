import assert from "node:assert/strict";
import {
  atomicStellarAmount,
  freshOrderSigner,
  freshPositionResult,
} from "./fresh-testnet-e2e-helpers";

assert.equal(atomicStellarAmount(1n), "0.0000001");
assert.equal(atomicStellarAmount(20_000_000n), "2.0000000");
assert.equal(atomicStellarAmount(22_500_001n), "2.2500001");
assert.throws(() => atomicStellarAmount(0n), /must be positive/);
assert.throws(() => atomicStellarAmount(-1n), /must be positive/);
assert.throws(
  () => atomicStellarAmount(1n, 12n),
  /power of ten/,
);

assert.equal(freshOrderSigner(), "charlie");
assert.equal(freshOrderSigner("alice"), "alice");
assert.equal(freshPositionResult(1, "YES"), "winner");
assert.equal(freshPositionResult(0, "NO"), "winner");
assert.equal(freshPositionResult(1, "NO"), "loser");
assert.equal(freshPositionResult(0, "YES"), "loser");
assert.equal(freshPositionResult(1, "LIVE"), null);
assert.equal(freshPositionResult(0, "VOID"), null);

process.stdout.write("fresh testnet E2E helpers ok\n");
