import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Address, StrKey } from "@stellar/stellar-sdk";
import {
  encryptAmount,
  multiply,
  publicKey,
} from "./committee/bn254-babyjub.mjs";
import {
  acceptedLeaf,
  addressLimbs,
  appendPairPath,
  batchPublicSignals,
  buildBatchStatement,
  bytes32Limbs,
  decryptAllocationWitness,
  fixedRoot,
  invocationResultValue,
  membershipPath,
  merkleNode,
  merkleTree,
  positionPayout,
  quoteFields,
  zeroRoots,
} from "./private-protocol.mjs";

const contract =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const invocation = Object.create({
  get result() {
    return { ok: true };
  },
});
assert.deepEqual(invocationResultValue(invocation), { ok: true });
assert.equal(invocationResultValue(7n), 7n);
const digest = createHash("sha256")
  .update(Address.fromString(contract).toScVal().toXDR())
  .digest();

assert.deepEqual(
  addressLimbs(contract),
  bytes32Limbs(digest),
  "address limbs must hash the canonical Stellar XDR",
);
assert.deepEqual(
  bytes32Limbs(Buffer.from(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "hex",
  )),
  [
    5233100606242806050955395731361295n,
    21356283574076891493948969979685445151n,
  ],
);

const zeros = zeroRoots(5);
assert.equal(merkleTree([], 5).root, zeros[5]);

const commitments = [11n, 12n, 13n, 14n];
const tree = merkleTree(commitments, 5);
for (let leafIndex = 0; leafIndex < commitments.length; leafIndex++) {
  let root = commitments[leafIndex];
  let index = leafIndex;
  for (const sibling of membershipPath(tree, leafIndex)) {
    root = index % 2 === 0
      ? merkleNode(root, sibling)
      : merkleNode(sibling, root);
    index = Math.floor(index / 2);
  }
  assert.equal(root, tree.root);
}

const appendSiblings = appendPairPath(tree);
const pairRoot = merkleNode(21n, 22n);
let appendedRoot = pairRoot;
let pairIndex = commitments.length / 2;
for (const sibling of appendSiblings) {
  appendedRoot = pairIndex % 2 === 0
    ? merkleNode(appendedRoot, sibling)
    : merkleNode(sibling, appendedRoot);
  pairIndex = Math.floor(pairIndex / 2);
}
assert.equal(
  appendedRoot,
  merkleTree([...commitments, 21n, 22n], 5).root,
);

assert.equal(fixedRoot([]), zeroRoots(6)[6]);
assert.equal(fixedRoot([1n, 2n]), merkleTree([
  1n,
  2n,
  ...Array(62).fill(0n),
], 6).root);
assert.throws(() => fixedRoot(Array(65).fill(1n)), /at most 64/);

assert.equal(positionPayout(1n << 32n), 10_000_000n);
assert.equal(positionPayout(1n), 1n);

const quote = Object.fromEntries([
  "state_version",
  "batch_size",
  "yes_count",
  "no_count",
  "pre_yes_price",
  "post_yes_price",
  "yes_price",
  "no_price",
  "aggregate_market_charge",
  "yes_market_cost",
  "no_market_cost",
  "yes_charge_per_position",
  "no_charge_per_position",
  "rounding_contribution",
  "fee_per_position",
  "fee_escrow",
  "conditional_lp_fee",
  "conditional_protocol_fee",
].map((name, index) => [name, BigInt(index)]));
assert.deepEqual(
  quoteFields(quote),
  Array.from({ length: 18 }, (_, index) => BigInt(index)),
);
assert.deepEqual(
  batchPublicSignals({
    networkDomain: [1n, 2n],
    vault: [3n, 4n],
    market: [5n, 6n],
    epoch: 7n,
    acceptedRoot: 8n,
    acceptedCount: 9n,
    firstSequence: 10n,
    lastSequence: 11n,
    committeeEpoch: 12n,
    committeeConfigHash: [13n, 14n],
    committeePublicKey: [15n, 16n],
    aggregateCiphertext: [17n, 18n, 19n, 20n, 21n, 22n, 23n, 24n],
    decryptionProofHash: [25n, 26n],
    committeeStatementHash: [27n, 28n],
    allocationRoot: 29n,
    includedRoot: 30n,
    lotSize: 31n,
    quote: Array.from({ length: 18 }, (_, index) => BigInt(index + 32)),
  }),
  Array.from({ length: 49 }, (_, index) => BigInt(index + 1)),
);

assert.throws(() => merkleTree([1n, 2n, 3n], 1), /capacity/);
assert.throws(
  () => appendPairPath(merkleTree([1n], 3)),
  /even next leaf/,
);
assert.throws(() => membershipPath(tree, 4), /outside/);

const market = StrKey.encodeContract(Buffer.alloc(32, 2));
const vault = StrKey.encodeContract(Buffer.alloc(32, 3));
const committeeSecret = 19n;
const committeeKey = publicKey(committeeSecret);
const sides = [1, 0, 1, 0, 1, 0, 1, 0];
const quantities = [3, 4, 2, 1, 5, 2, 4, 3];
const orders = sides.map((side, index) => {
  const yes = encryptAmount(
    committeeKey,
    side === 1 ? quantities[index] : 0,
    100n + BigInt(index),
  );
  const no = encryptAmount(
    committeeKey,
    side === 0 ? quantities[index] : 0,
    200n + BigInt(index),
  );
  return {
    sequence: 20n + BigInt(index),
    action_id: Buffer.alloc(32, index + 1),
    position_commitment: 1_000n + BigInt(index),
    encrypted_order: {
      yes_c1_x: yes.c1[0],
      yes_c1_y: yes.c1[1],
      yes_c2_x: yes.c2[0],
      yes_c2_y: yes.c2[1],
      no_c1_x: no.c1[0],
      no_c1_y: no.c1[1],
      no_c2_x: no.c2[0],
      no_c2_y: no.c2[1],
    },
  };
});
const acceptedRoot = fixedRoot(orders.map((order) => acceptedLeaf({
  market,
  epoch: 4n,
  sequence: order.sequence,
  actionId: order.action_id,
  positionCommitment: order.position_commitment,
  encryptedOrder: order.encrypted_order,
  committeeEpoch: 2n,
})));
const registration = {
  fixed_batch_size: 8,
  minimum_side_count: 2,
  committee_epoch: 2n,
  committee_config_hash: Buffer.alloc(32, 9),
  committee_public_key_x: committeeKey[0],
  committee_public_key_y: committeeKey[1],
  lot_size: 1n << 32n,
};
const batchQuote = {
  state_version: 3n,
  batch_size: 24,
  yes_count: 14,
  no_count: 10,
  pre_yes_price: 1n << 31n,
  post_yes_price: 1n << 31n,
  yes_price: 1n << 31n,
  no_price: 1n << 31n,
  aggregate_market_charge: 120_000_000n,
  yes_market_cost: 70_000_000n,
  no_market_cost: 50_000_000n,
  yes_charge_per_position: 5_000_000n,
  no_charge_per_position: 5_000_000n,
  rounding_contribution: 0n,
  fee_per_position: 100_000n,
  fee_escrow: 2_400_000n,
  conditional_lp_fee: 1_920_000n,
  conditional_protocol_fee: 480_000n,
};
const statement = buildBatchStatement({
  networkDomain: Buffer.alloc(32, 7),
  vault,
  market,
  registration,
  epoch: {
    epoch: 4n,
    accepted_count: 8,
    first_sequence: 20n,
    last_sequence: 27n,
    accepted_root: acceptedRoot,
  },
  orders,
  quote: batchQuote,
  committeeSecret,
});
assert.deepEqual(statement.sides, sides);
assert.equal(batchPublicSignals(statement.witness).length, 49);
assert.equal(statement.witness.acceptedRoot, acceptedRoot);
assert.notEqual(statement.allocationRoot, 0n);
assert.notEqual(statement.includedRoot, 0n);
assert.equal(statement.allocationPackages.length, 8);
const firstAllocation = decryptAllocationWitness(
  statement.allocationPackages[0].envelope,
  multiply(committeeKey, 8n * 100n),
);
assert.equal(firstAllocation.format, 1n);
assert.equal(firstAllocation.epoch, 4n);
assert.equal(firstAllocation.sequence, 20n);
assert.equal(firstAllocation.positionCommitment, 1_000n);
assert.equal(firstAllocation.side, 1n);
assert.equal(firstAllocation.charge, batchQuote.yes_charge_per_position * 3n);
assert.equal(firstAllocation.fee, batchQuote.fee_per_position * 3n);
assert.equal(firstAllocation.payout, 30_000_000n);
assert.equal(firstAllocation.leafIndex, 0n);
assert.equal(firstAllocation.siblings.length, 6);
assert.throws(
  () => decryptAllocationWitness(
    statement.allocationPackages[0].envelope,
    multiply(committeeKey, 8n * 101n),
  ),
  /authentication/,
);
assert.throws(
  () => buildBatchStatement({
    networkDomain: Buffer.alloc(32, 7),
    vault,
    market,
    registration,
    epoch: {
      epoch: 4n,
      accepted_count: 8,
      first_sequence: 20n,
      last_sequence: 27n,
      accepted_root: acceptedRoot,
    },
    orders,
    quote: batchQuote,
    committeeSecret: committeeSecret + 1n,
  }),
  /does not match/,
);

process.stdout.write("private protocol tests passed\n");
