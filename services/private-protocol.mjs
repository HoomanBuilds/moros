import { createHash, randomBytes } from "node:crypto";
import { Address } from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  aggregateCiphertexts,
  decryptAmount,
  encryptAmount,
  mod,
  multiply,
  publicKey,
} from "./committee/bn254-babyjub.mjs";

const MAXIMUM_BATCH_SIZE = 8;
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

export function invocationResultValue(value) {
  return value &&
    (typeof value === "object" || typeof value === "function") &&
    "result" in value
    ? value.result
    : value;
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
    decimal(encryptedOrder.yes_c1_x, "yes_c1_x"),
    decimal(encryptedOrder.yes_c1_y, "yes_c1_y"),
    decimal(encryptedOrder.yes_c2_x, "yes_c2_x"),
    decimal(encryptedOrder.yes_c2_y, "yes_c2_y"),
    decimal(encryptedOrder.no_c1_x, "no_c1_x"),
    decimal(encryptedOrder.no_c1_y, "no_c1_y"),
    decimal(encryptedOrder.no_c2_x, "no_c2_x"),
    decimal(encryptedOrder.no_c2_y, "no_c2_y"),
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

function allocationPlaintext({
  market,
  epoch,
  sequence,
  positionCommitment,
  side,
  charge,
  fee,
  payout,
  leafIndex,
  siblings,
}) {
  if (!Array.isArray(siblings) || siblings.length !== FIXED_TREE_LEVELS) {
    throw new Error("allocation witness must contain six siblings");
  }
  return [
    1n,
    ...addressLimbs(market),
    decimal(epoch, "epoch"),
    decimal(sequence, "sequence"),
    decimal(positionCommitment, "position commitment"),
    decimal(side, "side"),
    decimal(charge, "charge"),
    decimal(fee, "fee"),
    decimal(payout, "payout"),
    decimal(leafIndex, "allocation leaf index"),
    ...siblings.map((value) => decimal(value, "allocation sibling")),
  ];
}

function allocationAuthentication(shared, nonce, plaintext) {
  return poseidon2Hash([
    1015n,
    shared[0],
    shared[1],
    nonce,
    ...plaintext,
  ]);
}

export function encryptAllocationWitness({
  order,
  committeeSecret,
  nonce = mod(BigInt(`0x${randomBytes(31).toString("hex")}`)) || 1n,
  ...witness
}) {
  const shared = multiply(
    [
      decimal(order.encrypted_order.yes_c1_x, "yes_c1_x"),
      decimal(order.encrypted_order.yes_c1_y, "yes_c1_y"),
    ],
    8n * decimal(committeeSecret, "committee secret"),
  );
  const plaintext = allocationPlaintext(witness);
  const ciphertext = plaintext.map((value, index) =>
    mod(value + poseidon2Hash([
      1014n,
      shared[0],
      shared[1],
      nonce,
      BigInt(index),
    ]))
  );
  return {
    market: witness.market,
    epoch: decimal(witness.epoch, "epoch"),
    positionCommitment: decimal(
      witness.positionCommitment,
      "position commitment",
    ),
    envelope: [
      1n,
      nonce,
      ...ciphertext,
      allocationAuthentication(shared, nonce, plaintext),
    ],
  };
}

export function decryptAllocationWitness(envelope, shared) {
  if (!Array.isArray(envelope) || envelope.length !== 20) {
    throw new Error("allocation witness envelope has the wrong size");
  }
  const fields = envelope.map((value) => decimal(value));
  if (fields[0] !== 1n) {
    throw new Error("allocation witness envelope version is unsupported");
  }
  const nonce = fields[1];
  const plaintext = fields.slice(2, -1).map((value, index) =>
    mod(value - poseidon2Hash([
      1014n,
      decimal(shared[0]),
      decimal(shared[1]),
      nonce,
      BigInt(index),
    ]))
  );
  if (
    allocationAuthentication(
      shared.map((value) => decimal(value)),
      nonce,
      plaintext,
    ) !== fields.at(-1)
  ) {
    throw new Error("allocation witness authentication failed");
  }
  return {
    format: plaintext[0],
    market: plaintext.slice(1, 3),
    epoch: plaintext[3],
    sequence: plaintext[4],
    positionCommitment: plaintext[5],
    side: plaintext[6],
    charge: plaintext[7],
    fee: plaintext[8],
    payout: plaintext[9],
    leafIndex: plaintext[10],
    siblings: plaintext.slice(11),
  };
}

function ciphertext(record) {
  return {
    yes: {
      c1: [
        decimal(record.encrypted_order.yes_c1_x, "yes_c1_x"),
        decimal(record.encrypted_order.yes_c1_y, "yes_c1_y"),
      ],
      c2: [
        decimal(record.encrypted_order.yes_c2_x, "yes_c2_x"),
        decimal(record.encrypted_order.yes_c2_y, "yes_c2_y"),
      ],
    },
    no: {
      c1: [
        decimal(record.encrypted_order.no_c1_x, "no_c1_x"),
        decimal(record.encrypted_order.no_c1_y, "no_c1_y"),
      ],
      c2: [
        decimal(record.encrypted_order.no_c2_x, "no_c2_x"),
        decimal(record.encrypted_order.no_c2_y, "no_c2_y"),
      ],
    },
  };
}

export function decryptBatchQuantities(orders, committeeSecret) {
  if (
    !Array.isArray(orders) ||
    orders.length === 0 ||
    orders.length > MAXIMUM_BATCH_SIZE
  ) {
    throw new Error("a private batch must contain between one and eight orders");
  }
  return orders.map((record) => {
    const encrypted = ciphertext(record);
    const yes = decryptAmount(committeeSecret, encrypted.yes);
    const no = decryptAmount(committeeSecret, encrypted.no);
    if ((yes === 0) === (no === 0)) {
      throw new Error("private order must contain exactly one positive quantity");
    }
    return { yes, no, side: yes > 0 ? 1 : 0, quantity: yes + no };
  });
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
  if (
    !Array.isArray(orders) ||
    orders.length === 0 ||
    orders.length > MAXIMUM_BATCH_SIZE
  ) {
    throw new Error("a private batch must contain between one and eight orders");
  }
  if (
    Number(registration.maximum_batch_size) !== MAXIMUM_BATCH_SIZE ||
    Number(registration.minimum_side_count) !== 0 ||
    Number(epoch.accepted_count) !== orders.length
  ) {
    throw new Error("market does not use the adaptive private batch policy");
  }
  const firstSequence = decimal(epoch.first_sequence, "first sequence");
  const lastSequence = decimal(epoch.last_sequence, "last sequence");
  if (lastSequence - firstSequence !== BigInt(orders.length - 1)) {
    throw new Error("private batch order sequence is not contiguous");
  }
  const ordered = [...orders].sort((left, right) => {
    const leftSequence = decimal(left.sequence);
    const rightSequence = decimal(right.sequence);
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
  });
  const committeeEpoch = decimal(
    registration.committee_epoch,
    "committee epoch",
  );
  const configuredKey = [
    decimal(registration.committee_public_key_x),
    decimal(registration.committee_public_key_y),
  ];
  const derivedKey = publicKey(decimal(committeeSecret, "committee secret"));
  if (
    configuredKey[0] !== derivedKey[0] ||
    configuredKey[1] !== derivedKey[1]
  ) {
    throw new Error("committee secret does not match the registered public key");
  }
  const encrypted = ordered.map(ciphertext);
  const quantities = decryptBatchQuantities(ordered, committeeSecret);
  const sides = quantities.map((value) => value.side);
  const yesCount = quantities.reduce((total, value) => total + value.yes, 0);
  const noCount = quantities.reduce((total, value) => total + value.no, 0);
  const quotedYesCount = Number(quote.yes_count);
  const quotedNoCount = Number(quote.no_count);
  const quotedBatchSize = Number(quote.batch_size);
  if (
    quotedYesCount !== yesCount ||
    quotedNoCount !== noCount ||
    quotedBatchSize !== yesCount + noCount
  ) {
    throw new Error(
      "market quote does not match decrypted batch "
      + `(quote ${quotedYesCount}/${quotedNoCount}/${quotedBatchSize}, `
      + `decrypted ${yesCount}/${noCount}/${yesCount + noCount})`,
    );
  }
  const paddedEncrypted = [...encrypted];
  while (paddedEncrypted.length < MAXIMUM_BATCH_SIZE) {
    paddedEncrypted.push({
      yes: encryptAmount(configuredKey, 0),
      no: encryptAmount(configuredKey, 0),
    });
  }
  const aggregate = {
    yes: aggregateCiphertexts(paddedEncrypted.map((value) => value.yes)),
    no: aggregateCiphertexts(paddedEncrypted.map((value) => value.no)),
  };
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
    const quantity = BigInt(quantities[index].quantity);
    allocationLeaves.push(allocationLeaf({
      market,
      epoch: epoch.epoch,
      sequence,
      positionCommitment: order.position_commitment,
      side: sides[index],
      charge: quantity * BigInt(sides[index] === 1
        ? quote.yes_charge_per_position
        : quote.no_charge_per_position),
      fee: quantity * BigInt(quote.fee_per_position),
      payout: quantity * payout,
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
  const allocationTree = merkleTree(
    [
      ...allocationLeaves,
      ...Array(FIXED_TREE_LEAVES - allocationLeaves.length).fill(0n),
    ],
    FIXED_TREE_LEVELS,
  );
  const allocationPackages = ordered.map((order, index) => {
    const side = sides[index];
    return encryptAllocationWitness({
      order,
      committeeSecret,
      market,
      epoch: epoch.epoch,
      sequence: order.sequence,
      positionCommitment: order.position_commitment,
      side,
      charge: BigInt(quantities[index].quantity) * BigInt(side === 1
        ? quote.yes_charge_per_position
        : quote.no_charge_per_position),
      fee: BigInt(quantities[index].quantity) * BigInt(quote.fee_per_position),
      payout: BigInt(quantities[index].quantity) * payout,
      leafIndex: index,
      siblings: membershipPath(allocationTree, index),
    });
  });
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
    quantities,
  };
  const decryptionProofHash = transcriptHash(
    "decryption",
    { ...publicTranscript, quantities },
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
    committeePublicKey: configuredKey,
    aggregateCiphertext: [
      aggregate.yes.c1[0],
      aggregate.yes.c1[1],
      aggregate.yes.c2[0],
      aggregate.yes.c2[1],
      aggregate.no.c1[0],
      aggregate.no.c1[1],
      aggregate.no.c2[0],
      aggregate.no.c2[1],
    ],
    decryptionProofHash: bytes32Limbs(decryptionProofHash),
    committeeStatementHash: bytes32Limbs(committeeStatementHash),
    allocationRoot,
    includedRoot,
    lotSize: decimal(registration.lot_size),
    quote: quoteFields(quote),
    committeeSecret: decimal(committeeSecret, "committee secret"),
    actionId: [
      ...ordered.map((order) => bytes32Limbs(order.action_id)),
      ...Array(MAXIMUM_BATCH_SIZE - ordered.length).fill([0n, 0n]),
    ],
    positionCommitment: [
      ...ordered.map((order) => decimal(order.position_commitment)),
      ...Array(MAXIMUM_BATCH_SIZE - ordered.length).fill(0n),
    ],
    ciphertext: paddedEncrypted.map((value) => [
      value.yes.c1[0],
      value.yes.c1[1],
      value.yes.c2[0],
      value.yes.c2[1],
      value.no.c1[0],
      value.no.c1[1],
      value.no.c2[0],
      value.no.c2[1],
    ]),
    yesAmount: [
      ...quantities.map((value) => value.yes),
      ...Array(MAXIMUM_BATCH_SIZE - ordered.length).fill(0),
    ],
    noAmount: [
      ...quantities.map((value) => value.no),
      ...Array(MAXIMUM_BATCH_SIZE - ordered.length).fill(0),
    ],
  };
  return {
    witness,
    sides,
    aggregate,
    allocationRoot,
    includedRoot,
    allocationPackages,
    decryptionProofHash,
    committeeStatementHash,
  };
}

export function batchPublicSignals(witness) {
  return [
    ...witness.networkDomain,
    ...witness.vault,
    ...witness.market,
    witness.epoch,
    witness.acceptedRoot,
    witness.acceptedCount,
    witness.firstSequence,
    witness.lastSequence,
    witness.committeeEpoch,
    ...witness.committeeConfigHash,
    ...witness.committeePublicKey,
    ...witness.aggregateCiphertext,
    ...witness.decryptionProofHash,
    ...witness.committeeStatementHash,
    witness.allocationRoot,
    witness.includedRoot,
    witness.lotSize,
    ...witness.quote,
  ].map((value) => decimal(value));
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
