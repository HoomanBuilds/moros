import { createHash } from "node:crypto";
import { Address } from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  aggregateCiphertexts,
  decryptSide,
} from "./committee/bn254-babyjub.mjs";

const FIXED_BATCH_SIZE = 8;
const FIXED_TREE_LEAVES = 64;
const FIXED_TREE_LEVELS = 6;
const Q32 = 1n << 32n;
const USDC_SCALE = 10_000_000n;

export function decimal(value, name = "value") {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`${name} must be a nonnegative integer`);
}

export function bytes(value, length, name = "value") {
  const result = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : typeof value === "string" && /^[0-9a-fA-F]+$/.test(value)
      ? Buffer.from(value, "hex")
      : null;
  if (!result || result.length !== length) {
    throw new Error(`${name} must be ${length} bytes`);
  }
  return result;
}

export function bytes32Limbs(value) {
  const encoded = bytes(value, 32, "bytes32");
  return [
    BigInt(`0x${encoded.subarray(0, 16).toString("hex")}`),
    BigInt(`0x${encoded.subarray(16).toString("hex")}`),
  ];
}

export function addressLimbs(value) {
  const address = Address.fromString(value);
  const digest = createHash("sha256")
    .update(address.toScVal().toXDR())
    .digest();
  return bytes32Limbs(digest);
}

export function merkleNode(left, right) {
  return poseidon2Hash([1005n, decimal(left), decimal(right)]);
}

export function zeroRoots(levels) {
  if (!Number.isSafeInteger(levels) || levels < 1 || levels > 31) {
    throw new Error("tree levels must be between 1 and 31");
  }
  const roots = [0n];
  for (let level = 0; level < levels; level++) {
    roots.push(merkleNode(roots[level], roots[level]));
  }
  return roots;
}

export function merkleTree(commitments, levels) {
  if (!Array.isArray(commitments)) {
    throw new Error("commitments must be an array");
  }
  const capacity = 2 ** levels;
  if (commitments.length > capacity) {
    throw new Error("commitments exceed tree capacity");
  }
  const zeros = zeroRoots(levels);
  const layers = [commitments.map((value) => decimal(value, "commitment"))];
  for (let level = 0; level < levels; level++) {
    const current = layers[level];
    const next = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(merkleNode(
        current[index],
        current[index + 1] ?? zeros[level],
      ));
    }
    if (next.length === 0) next.push(zeros[level + 1]);
    layers.push(next);
  }
  return {
    root: layers[levels][0],
    layers,
    zeros,
    levels,
    count: commitments.length,
  };
}

export function membershipPath(tree, leafIndex) {
  if (
    !Number.isSafeInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= tree.count
  ) {
    throw new Error("leaf index is outside the populated tree");
  }
  const siblings = [];
  let index = leafIndex;
  for (let level = 0; level < tree.levels; level++) {
    siblings.push(
      tree.layers[level][index ^ 1] ?? tree.zeros[level],
    );
    index = Math.floor(index / 2);
  }
  return siblings;
}

export function appendPairPath(tree) {
  if (tree.count % 2 !== 0) {
    throw new Error("pair append requires an even next leaf index");
  }
  if (tree.count + 2 > 2 ** tree.levels) {
    throw new Error("pair append exceeds tree capacity");
  }
  const siblings = [];
  let index = tree.count / 2;
  for (let level = 1; level < tree.levels; level++) {
    siblings.push(
      tree.layers[level][index ^ 1] ?? tree.zeros[level],
    );
    index = Math.floor(index / 2);
  }
  return siblings;
}

export function fixedRoot(leaves) {
  if (!Array.isArray(leaves) || leaves.length > FIXED_TREE_LEAVES) {
    throw new Error("fixed tree accepts at most 64 leaves");
  }
  return merkleTree(
    [
      ...leaves.map((value) => decimal(value, "fixed tree leaf")),
      ...Array(FIXED_TREE_LEAVES - leaves.length).fill(0n),
    ],
    FIXED_TREE_LEVELS,
  ).root;
}

export function acceptedLeaf({
  market,
  epoch,
  sequence,
  actionId,
  positionCommitment,
  encryptedOrder,
  committeeEpoch,
}) {
  return poseidon2Hash([
    1009n,
    ...addressLimbs(market),
    decimal(epoch, "epoch"),
    decimal(sequence, "sequence"),
    ...bytes32Limbs(actionId),
    decimal(positionCommitment, "position commitment"),
    decimal(encryptedOrder.c1_x, "c1_x"),
    decimal(encryptedOrder.c1_y, "c1_y"),
    decimal(encryptedOrder.c2_x, "c2_x"),
    decimal(encryptedOrder.c2_y, "c2_y"),
    decimal(committeeEpoch, "committee epoch"),
  ]);
}

export function allocationLeaf({
  market,
  epoch,
  sequence,
  positionCommitment,
  side,
  charge,
  fee,
  payout,
}) {
  return poseidon2Hash([
    1012n,
    ...addressLimbs(market),
    decimal(epoch, "epoch"),
    decimal(sequence, "sequence"),
    decimal(positionCommitment, "position commitment"),
    decimal(side, "side"),
    decimal(charge, "charge"),
    decimal(fee, "fee"),
    decimal(payout, "payout"),
  ]);
}

export function includedLeaf({
  market,
  epoch,
  sequence,
  positionCommitment,
}) {
  return poseidon2Hash([
    1013n,
    ...addressLimbs(market),
    decimal(epoch, "epoch"),
    decimal(sequence, "sequence"),
    decimal(positionCommitment, "position commitment"),
  ]);
}

export function quoteFields(quote) {
  const names = [
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
  ];
  return names.map((name) => decimal(quote[name], name));
}

export function positionPayout(lotSize) {
  const numerator = decimal(lotSize, "lot size") * USDC_SCALE;
  return (numerator + Q32 - 1n) / Q32;
}

function ciphertext(record) {
  return {
    c1: [
      decimal(record.encrypted_order.c1_x, "c1_x"),
      decimal(record.encrypted_order.c1_y, "c1_y"),
    ],
    c2: [
      decimal(record.encrypted_order.c2_x, "c2_x"),
      decimal(record.encrypted_order.c2_y, "c2_y"),
    ],
  };
}

function transcriptHash(label, value) {
  const serialized = JSON.stringify(value, (_, field) =>
    typeof field === "bigint" ? field.toString() : field
  );
  return createHash("sha256")
    .update(`Moros private batch:${label}:`)
    .update(serialized)
    .digest();
}

export function buildBatchStatement({
  networkDomain,
  vault,
  market,
  registration,
  epoch,
  orders,
  quote,
  committeeSecret,
}) {
  if (!Array.isArray(orders) || orders.length !== FIXED_BATCH_SIZE) {
    throw new Error("a private batch must contain exactly eight orders");
  }
  const firstSequence = decimal(epoch.first_sequence, "first sequence");
  const lastSequence = decimal(epoch.last_sequence, "last sequence");
  if (lastSequence - firstSequence !== 7n) {
    throw new Error("private batch order sequence is not contiguous");
  }
  const ordered = [...orders].sort((left, right) =>
    Number(decimal(left.sequence) - decimal(right.sequence))
  );
  const committeeEpoch = decimal(
    registration.committee_epoch,
    "committee epoch",
  );
  const encrypted = ordered.map(ciphertext);
  const sides = encrypted.map((value) =>
    decryptSide(committeeSecret, value)
  );
  const yesCount = sides.filter((side) => side === 1).length;
  const noCount = sides.length - yesCount;
  if (
    yesCount < Number(registration.minimum_side_count) ||
    noCount < Number(registration.minimum_side_count)
  ) {
    throw new Error("private batch does not satisfy minimum side counts");
  }
  if (
    Number(quote.yes_count) !== yesCount ||
    Number(quote.no_count) !== noCount ||
    Number(quote.batch_size) !== FIXED_BATCH_SIZE
  ) {
    throw new Error("market quote does not match decrypted batch");
  }
  const aggregate = aggregateCiphertexts(encrypted);
  const payout = positionPayout(registration.lot_size);
  const acceptedLeaves = [];
  const allocationLeaves = [];
  const includedLeaves = [];
  for (let index = 0; index < ordered.length; index++) {
    const order = ordered[index];
    const sequence = decimal(order.sequence, "sequence");
    if (sequence !== firstSequence + BigInt(index)) {
      throw new Error("private batch orders are missing a sequence");
    }
    acceptedLeaves.push(acceptedLeaf({
      market,
      epoch: epoch.epoch,
      sequence,
      actionId: order.action_id,
      positionCommitment: order.position_commitment,
      encryptedOrder: order.encrypted_order,
      committeeEpoch,
    }));
    allocationLeaves.push(allocationLeaf({
      market,
      epoch: epoch.epoch,
      sequence,
      positionCommitment: order.position_commitment,
      side: sides[index],
      charge: sides[index] === 1
        ? quote.yes_charge_per_position
        : quote.no_charge_per_position,
      fee: quote.fee_per_position,
      payout,
    }));
    includedLeaves.push(includedLeaf({
      market,
      epoch: epoch.epoch,
      sequence,
      positionCommitment: order.position_commitment,
    }));
  }
  const acceptedRoot = fixedRoot(acceptedLeaves);
  if (acceptedRoot !== decimal(epoch.accepted_root, "accepted root")) {
    throw new Error("reconstructed accepted root does not match the epoch");
  }
  const allocationRoot = fixedRoot(allocationLeaves);
  const includedRoot = fixedRoot(includedLeaves);
  const publicTranscript = {
    market,
    epoch: decimal(epoch.epoch),
    firstSequence,
    lastSequence,
    acceptedRoot,
    allocationRoot,
    includedRoot,
    yesCount,
    noCount,
    aggregate,
  };
  const decryptionProofHash = transcriptHash(
    "decryption",
    { ...publicTranscript, sides },
  );
  const committeeStatementHash = transcriptHash(
    "statement",
    publicTranscript,
  );
  const witness = {
    networkDomain: bytes32Limbs(networkDomain),
    vault: addressLimbs(vault),
    market: addressLimbs(market),
    epoch: decimal(epoch.epoch),
    acceptedRoot,
    acceptedCount: decimal(epoch.accepted_count),
    firstSequence,
    lastSequence,
    committeeEpoch,
    committeeConfigHash: bytes32Limbs(
      registration.committee_config_hash,
    ),
    committeePublicKey: [
      decimal(registration.committee_public_key_x),
      decimal(registration.committee_public_key_y),
    ],
    aggregateCiphertext: [
      aggregate.c1[0],
      aggregate.c1[1],
      aggregate.c2[0],
      aggregate.c2[1],
    ],
    decryptionProofHash: bytes32Limbs(decryptionProofHash),
    committeeStatementHash: bytes32Limbs(committeeStatementHash),
    allocationRoot,
    includedRoot,
    lotSize: decimal(registration.lot_size),
    quote: quoteFields(quote),
    committeeSecret: decimal(committeeSecret, "committee secret"),
    actionId: ordered.map((order) => bytes32Limbs(order.action_id)),
    positionCommitment: ordered.map((order) =>
      decimal(order.position_commitment)
    ),
    ciphertext: encrypted.map((value) => [
      value.c1[0],
      value.c1[1],
      value.c2[0],
      value.c2[1],
    ]),
  };
  return {
    witness,
    sides,
    aggregate,
    allocationRoot,
    includedRoot,
    decryptionProofHash,
    committeeStatementHash,
  };
}

export function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  return value;
}
