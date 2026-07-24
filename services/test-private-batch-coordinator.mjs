import assert from "node:assert/strict";
import { StrKey } from "@stellar/stellar-sdk";
import {
  encryptAmount,
  publicKey,
} from "./committee/bn254-babyjub.mjs";
import {
  PrivateBatchCoordinator,
  phaseName,
  quoteResultValue,
} from "./private-batch-coordinator.mjs";
import {
  acceptedLeaf,
  fixedRoot,
} from "./private-protocol.mjs";

assert.equal(phaseName("Collecting"), "Collecting");
assert.equal(phaseName({ tag: "Executed" }), "Executed");
assert.equal(phaseName(["Refundable"]), "Refundable");
assert.throws(() => phaseName({}), /unknown/);
assert.deepEqual(
  quoteResultValue({ result: { value: { yes_count: 9, no_count: 6 } } }),
  { yes_count: 9, no_count: 6 },
);
assert.deepEqual(
  quoteResultValue({ result: { yes_count: 4, no_count: 4 } }),
  { yes_count: 4, no_count: 4 },
);

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
let finalizeCalls = 0;
let outcome;
const registration = {
  finalized: false,
  current_epoch: 1n,
  maximum_batch_size: 8,
  minimum_side_count: 0,
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
  finalize_market: async () => transaction(undefined, () => {
    finalizeCalls++;
  }),
};
const coordinator = new PrivateBatchCoordinator({
  vault,
  vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  networkDomain: Buffer.alloc(32, 1),
  committeeSecret: 1n,
  marketClient: async () => ({ outcome: async () => ({ result: outcome }) }),
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
registration.finalized = false;
outcome = { tag: "Yes" };
assert.equal((await coordinator.process("market")).status, "finalized");
assert.equal(finalizeCalls, 1);

const adaptiveMarket = StrKey.encodeContract(Buffer.alloc(32, 2));
const adaptiveSecret = 19n;
const adaptiveKey = publicKey(adaptiveSecret);
const encryptedYes = encryptAmount(adaptiveKey, 3, 101n);
const encryptedNo = encryptAmount(adaptiveKey, 0, 102n);
const adaptiveOrder = {
  sequence: 1n,
  action_id: Buffer.alloc(32, 4),
  position_commitment: 1_001n,
  encrypted_order: {
    yes_c1_x: encryptedYes.c1[0],
    yes_c1_y: encryptedYes.c1[1],
    yes_c2_x: encryptedYes.c2[0],
    yes_c2_y: encryptedYes.c2[1],
    no_c1_x: encryptedNo.c1[0],
    no_c1_y: encryptedNo.c1[1],
    no_c2_x: encryptedNo.c2[0],
    no_c2_y: encryptedNo.c2[1],
  },
};
const adaptiveRoot = fixedRoot([acceptedLeaf({
  market: adaptiveMarket,
  epoch: 1n,
  sequence: 1n,
  actionId: adaptiveOrder.action_id,
  positionCommitment: adaptiveOrder.position_commitment,
  encryptedOrder: adaptiveOrder.encrypted_order,
  committeeEpoch: 1n,
})]);
let adaptivePhase = "Collecting";
let adaptiveSubmitCalls = 0;
let adaptiveProofCalls = 0;
let adaptiveAllocationCount = 0;
const adaptiveRegistration = {
  finalized: false,
  current_epoch: 1n,
  maximum_batch_size: 8,
  minimum_side_count: 0,
  expiry: 1_000n,
  committee_epoch: 1n,
  committee_config_hash: Buffer.alloc(32, 8),
  committee_public_key_x: adaptiveKey[0],
  committee_public_key_y: adaptiveKey[1],
  lot_size: 1n << 32n,
};
const adaptiveEpoch = () => ({
  epoch: 1n,
  phase: adaptivePhase,
  accepted_count: 1,
  first_sequence: 1n,
  last_sequence: 1n,
  cutoff: 200n,
  refund_at: 300n,
  market_state_version: 4n,
  accepted_root: adaptiveRoot,
});
const adaptiveQuote = {
  state_version: 4n,
  batch_size: 3,
  yes_count: 3,
  no_count: 0,
  pre_yes_price: 1n << 31n,
  post_yes_price: 1n << 31n,
  yes_price: 1n << 31n,
  no_price: 1n << 31n,
  aggregate_market_charge: 15_000_000n,
  yes_market_cost: 15_000_000n,
  no_market_cost: 0n,
  yes_charge_per_position: 5_000_000n,
  no_charge_per_position: 0n,
  rounding_contribution: 0n,
  fee_per_position: 100_000n,
  fee_escrow: 300_000n,
  conditional_lp_fee: 240_000n,
  conditional_protocol_fee: 60_000n,
};
const adaptiveVault = {
  registration: async () => ({ result: adaptiveRegistration }),
  epoch: async () => ({ result: adaptiveEpoch() }),
  order: async () => ({ result: adaptiveOrder }),
  seal_epoch: async () => transaction(undefined, () => {
    adaptivePhase = "Sealed";
  }),
  submit_batch: async () => transaction(undefined, () => {
    adaptiveSubmitCalls++;
    adaptivePhase = "Executed";
  }),
};
const adaptiveCoordinator = new PrivateBatchCoordinator({
  vault: adaptiveVault,
  vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  networkDomain: Buffer.alloc(32, 1),
  committeeSecret: adaptiveSecret,
  marketClient: async () => ({
    outcome: async () => ({ result: undefined }),
    quote_private_batch: async () => ({ result: adaptiveQuote }),
  }),
  prove: async (witness) => {
    adaptiveProofCalls++;
    assert.equal(witness.acceptedCount, 1n);
    return Buffer.alloc(192, 1);
  },
  publishAllocations: async (packages) => {
    adaptiveAllocationCount = packages.length;
  },
  now: () => 201,
});
const adaptiveResult = await adaptiveCoordinator.process(adaptiveMarket);
assert.equal(adaptiveResult.status, "executed");
assert.equal(adaptiveResult.yesCount, 3);
assert.equal(adaptiveResult.noCount, 0);
assert.equal(adaptiveProofCalls, 1);
assert.equal(adaptiveAllocationCount, 1);
assert.equal(adaptiveSubmitCalls, 1);

process.stdout.write("private batch coordinator tests passed\n");
