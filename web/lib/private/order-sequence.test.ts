import assert from "node:assert/strict";
import { nextPrivateOrderSequence } from "./order-sequence.ts";

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

process.stdout.write("private order sequence ok\n");
