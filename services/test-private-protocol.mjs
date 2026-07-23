import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Address } from "@stellar/stellar-sdk";
import {
  addressLimbs,
  appendPairPath,
  batchPublicSignals,
  bytes32Limbs,
  fixedRoot,
  membershipPath,
  merkleNode,
  merkleTree,
  positionPayout,
  quoteFields,
  zeroRoots,
} from "./private-protocol.mjs";

const contract =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
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
    aggregateCiphertext: [17n, 18n, 19n, 20n],
    decryptionProofHash: [21n, 22n],
    committeeStatementHash: [23n, 24n],
    allocationRoot: 25n,
    includedRoot: 26n,
    lotSize: 27n,
    quote: Array.from({ length: 18 }, (_, index) => BigInt(index + 28)),
  }),
  Array.from({ length: 45 }, (_, index) => BigInt(index + 1)),
);

assert.throws(() => merkleTree([1n, 2n, 3n], 1), /capacity/);
assert.throws(
  () => appendPairPath(merkleTree([1n], 3)),
  /even next leaf/,
);
assert.throws(() => membershipPath(tree, 4), /outside/);

process.stdout.write("private protocol tests passed\n");
