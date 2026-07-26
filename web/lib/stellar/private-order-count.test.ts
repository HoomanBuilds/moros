import assert from "node:assert/strict";
import { privateOrderCountFromEpochs } from "./private-order-count.ts";

assert.equal(
  privateOrderCountFromEpochs({
    currentEpochNumber: 0n,
    currentEpoch: { accepted_count: 0, last_sequence: 0n },
  }),
  0,
);

assert.equal(
  privateOrderCountFromEpochs({
    currentEpochNumber: 2n,
    currentEpoch: { accepted_count: 1, last_sequence: 4n },
    previousEpoch: { accepted_count: 2, last_sequence: 3n },
  }),
  4,
);

assert.equal(
  privateOrderCountFromEpochs({
    currentEpochNumber: 3n,
    currentEpoch: { accepted_count: 0, last_sequence: 0n },
    previousEpoch: { accepted_count: 1, last_sequence: 3n },
  }),
  3,
);

assert.throws(
  () => privateOrderCountFromEpochs({
    currentEpochNumber: 1n,
    currentEpoch: null,
    previousEpoch: {
      accepted_count: 1,
      last_sequence: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    },
  }),
  /supported display range/,
);

console.log("private order count ok");
