import assert from "node:assert/strict";
import {
  PrivateBatchCoordinator,
  phaseName,
} from "./private-batch-coordinator.mjs";

assert.equal(phaseName("Collecting"), "Collecting");
assert.equal(phaseName({ tag: "Executed" }), "Executed");
assert.equal(phaseName(["Refundable"]), "Refundable");
assert.throws(() => phaseName({}), /unknown/);

function transaction(result, effect = () => {}) {
  return {
    signAndSend: async () => {
      effect();
      return { result };
    },
  };
}

let phase = "Collecting";
let acceptedCount = 0;
let now = 100;
let sealCalls = 0;
let refundableCalls = 0;
let openCalls = 0;
const registration = {
  finalized: false,
  current_epoch: 1n,
  fixed_batch_size: 8,
  minimum_side_count: 2,
  expiry: 1_000n,
};
const epochValue = () => ({
  epoch: 1n,
  phase,
  accepted_count: acceptedCount,
  first_sequence: acceptedCount === 0 ? 0n : 1n,
  last_sequence: BigInt(acceptedCount),
  cutoff: 200n,
  refund_at: 300n,
});
const vault = {
  registration: async () => ({ result: registration }),
  epoch: async () => ({ result: epochValue() }),
  seal_epoch: async () => transaction(undefined, () => {
    phase = "Sealed";
    sealCalls++;
  }),
  make_epoch_refundable: async () => transaction(undefined, () => {
    phase = "Refundable";
    refundableCalls++;
  }),
  open_next_epoch: async () => transaction({ epoch: 2n }, () => {
    openCalls++;
  }),
};
const coordinator = new PrivateBatchCoordinator({
  vault,
  vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  networkDomain: Buffer.alloc(32, 1),
  committeeSecret: 1n,
  marketClient: async () => {
    throw new Error("not expected");
  },
  prove: async () => {
    throw new Error("not expected");
  },
  now: () => now,
});

assert.equal((await coordinator.process("market")).status, "collecting");
assert.equal(sealCalls, 0);

now = 201;
assert.equal((await coordinator.process("market")).status, "sealed-incomplete");
assert.equal(sealCalls, 1);

now = 301;
assert.equal((await coordinator.process("market")).status, "refundable");
assert.equal(refundableCalls, 1);

assert.equal((await coordinator.process("market")).status, "opened");
assert.equal(openCalls, 1);

registration.finalized = true;
assert.equal((await coordinator.process("market")).status, "finalized");

process.stdout.write("private batch coordinator tests passed\n");
