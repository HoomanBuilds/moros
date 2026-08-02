import assert from "node:assert/strict";
import {
  bindPrivateOrderSequence,
  nextPrivateOrderSequence,
  preparePrivateOrderSequence,
} from "./order-sequence.ts";

async function main() {
assert.equal(nextPrivateOrderSequence({
  epoch: 2n,
  accepted_count: 3,
  last_sequence: 7n,
}, []), 8n);

assert.equal(nextPrivateOrderSequence({
  epoch: 0n,
  accepted_count: 0,
  last_sequence: 0n,
}, []), 1n);

assert.equal(nextPrivateOrderSequence({
  epoch: 3n,
  accepted_count: 0,
  last_sequence: 0n,
}, [
  { epoch: 2n, accepted_count: 0, last_sequence: 0n },
  { epoch: 1n, accepted_count: 0, last_sequence: 0n },
  { epoch: 0n, accepted_count: 0, last_sequence: 0n },
]), 1n);

assert.equal(nextPrivateOrderSequence({
  epoch: 4n,
  accepted_count: 0,
  last_sequence: 0n,
}, [
  { epoch: 3n, accepted_count: 0, last_sequence: 0n },
  { epoch: 2n, accepted_count: 2, last_sequence: 11n },
]), 12n);

const reads: bigint[] = [];
const rebound = await bindPrivateOrderSequence({
  initialSequence: 1n,
  build: (sequence) => ({ sequence, commitment: sequence * 10n }),
  read: async (candidate) => {
    reads.push(candidate.sequence);
    return { sequence: 42n, commitment: candidate.commitment };
  },
});
assert.equal(rebound.sequence, 42n);
assert.equal(rebound.candidate.commitment, 420n);
assert.deepEqual(reads, [1n, 42n]);

const operations: string[] = [];
let releaseRead = () => {};
const readPending = new Promise<void>((resolve) => {
  releaseRead = resolve;
});
const prepared = await preparePrivateOrderSequence({
  initialSequence: 7n,
  build: (sequence) => ({ sequence }),
  read: async () => {
    operations.push("read-start");
    await readPending;
    operations.push("read-end");
    return { sequence: 7n };
  },
  prepare: async () => {
    operations.push("prepare");
    releaseRead();
    return "root";
  },
});
assert.equal(prepared.prepared, "root");
assert.deepEqual(operations, ["read-start", "prepare", "read-end"]);

let changingSequence = 2n;
await assert.rejects(
  bindPrivateOrderSequence({
    initialSequence: 1n,
    build: (sequence) => sequence,
    read: async () => ({ sequence: changingSequence++ }),
  }),
  /sequence changed/u,
);

process.stdout.write("private order sequence ok\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
