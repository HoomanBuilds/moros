"use client";

import { Address } from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";

export const PRIVATE_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const PRIVATE_TREE_LEVELS = 20;

const BABYJUB_A = 168700n;
const BABYJUB_D = 168696n;
const BABYJUB_BASE8: Point = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

export type Point = [bigint, bigint];

export type PrivateNote = {
  noteDomain: bigint;
  purpose: bigint;
  amount: bigint;
  spendPublicKey: bigint;
  viewingPublicKey: Point;
  noteId: bigint;
  payloadHash: bigint;
  privateData: Point;
  blinding: bigint;
  commitment: bigint;
};

export type OwnedPrivateNote = PrivateNote & {
  spendSecret: bigint;
  viewingSecret: bigint;
};

export type PrivateOutput = PrivateNote & {
  ephemeralSecret: bigint;
  nonce: bigint;
  envelope: bigint[];
  envelopeHash: bigint;
};

export type PrivateTree = {
  levels: number;
  count: number;
  root: bigint;
  layers: bigint[][];
  zeros: bigint[];
};

export type PrivateAllocationWitness = {
  format: bigint;
  market: Point;
  epoch: bigint;
  sequence: bigint;
  positionCommitment: bigint;
  side: bigint;
  charge: bigint;
  fee: bigint;
  payout: bigint;
  leafIndex: number;
  siblings: bigint[];
};

export function modField(value: bigint): bigint {
  const reduced = value % PRIVATE_FIELD;
  return reduced < 0n ? reduced + PRIVATE_FIELD : reduced;
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let current = modField(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = modField(result * current);
    current = modField(current * current);
    remaining >>= 1n;
  }
  return result;
}

function inverse(value: bigint): bigint {
  if (modField(value) === 0n) throw new Error("Invalid private curve point");
  return power(value, PRIVATE_FIELD - 2n);
}

export function addPoints(left: Point, right: Point): Point {
  const [x1, y1] = left;
  const [x2, y2] = right;
  const product = modField(x1 * x2 * y1 * y2);
  return [
    modField((x1 * y2 + y1 * x2) * inverse(1n + BABYJUB_D * product)),
    modField((y1 * y2 - BABYJUB_A * x1 * x2) * inverse(1n - BABYJUB_D * product)),
  ];
}

export function multiplyPoint(point: Point, scalar: bigint): Point {
  let result: Point = [0n, 1n];
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

export function viewingPublicKey(secret: bigint): Point {
  return multiplyPoint(BABYJUB_BASE8, secret);
}

export function spendPublicKey(secret: bigint): bigint {
  return poseidon2Hash([1002n, secret]);
}

export function noteDomain(contextFields: bigint[]): bigint {
  if (contextFields.length < 9) throw new Error("Private context is incomplete");
  return poseidon2Hash([1001n, ...contextFields.slice(1, 9)]);
}

export function noteCommitment(note: Omit<PrivateNote, "commitment">): bigint {
  return poseidon2Hash([
    1003n,
    note.noteDomain,
    note.purpose,
    note.amount,
    note.spendPublicKey,
    note.viewingPublicKey[0],
    note.viewingPublicKey[1],
    note.noteId,
    note.payloadHash,
    note.privateData[0],
    note.privateData[1],
    note.blinding,
  ]);
}

export function noteNullifier(
  note: PrivateNote,
  spendSecret: bigint,
  nullifierDomain = 1n,
): bigint {
  return poseidon2Hash([
    1004n,
    note.noteDomain,
    nullifierDomain,
    note.commitment,
    spendSecret,
    note.noteId,
  ]);
}

export function createOutputNote({
  outputIndex,
  domain,
  purpose,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  payloadHash = 0n,
  privateData = [0n, 0n],
  blinding,
  ephemeralSecret,
  nonce,
}: {
  outputIndex: number;
  domain: bigint;
  purpose: bigint;
  amount: bigint;
  spendSecret: bigint;
  viewingSecret: bigint;
  noteId: bigint;
  payloadHash?: bigint;
  privateData?: Point;
  blinding: bigint;
  ephemeralSecret: bigint;
  nonce: bigint;
}): PrivateOutput {
  return createOutputNoteForRecipient({
    outputIndex,
    domain,
    purpose,
    amount,
    spendPublicKey: spendPublicKey(spendSecret),
    viewingPublicKey: viewingPublicKey(viewingSecret),
    noteId,
    payloadHash,
    privateData,
    blinding,
    ephemeralSecret,
    nonce,
  });
}

export function createOutputNoteForRecipient({
  outputIndex,
  domain,
  purpose,
  amount,
  spendPublicKey: recipientSpendPublicKey,
  viewingPublicKey: recipientViewingPublicKey,
  noteId,
  payloadHash = 0n,
  privateData = [0n, 0n],
  blinding,
  ephemeralSecret,
  nonce,
}: {
  outputIndex: number;
  domain: bigint;
  purpose: bigint;
  amount: bigint;
  spendPublicKey: bigint;
  viewingPublicKey: Point;
  noteId: bigint;
  payloadHash?: bigint;
  privateData?: Point;
  blinding: bigint;
  ephemeralSecret: bigint;
  nonce: bigint;
}): PrivateOutput {
  const ephemeralPublicKey = multiplyPoint(BABYJUB_BASE8, ephemeralSecret);
  const sharedSecret = multiplyPoint(
    multiplyPoint(recipientViewingPublicKey, 8n),
    ephemeralSecret,
  );
  const plaintext = [
    purpose,
    amount,
    recipientSpendPublicKey,
    recipientViewingPublicKey[0],
    recipientViewingPublicKey[1],
    noteId,
    payloadHash,
    privateData[0],
    privateData[1],
    blinding,
  ];
  const ciphertext = plaintext.map((value, index) =>
    modField(value + poseidon2Hash([
      1006n,
      sharedSecret[0],
      sharedSecret[1],
      nonce,
      BigInt(outputIndex),
      BigInt(index),
    ]))
  );
  const authentication = poseidon2Hash([
    1007n,
    sharedSecret[0],
    sharedSecret[1],
    nonce,
    BigInt(outputIndex),
    ...plaintext,
  ]);
  const envelope = [1n, ...ephemeralPublicKey, nonce, ...ciphertext, authentication];
  const note = {
    noteDomain: domain,
    purpose,
    amount,
    spendPublicKey: recipientSpendPublicKey,
    viewingPublicKey: recipientViewingPublicKey,
    noteId,
    payloadHash,
    privateData,
    blinding,
  };
  return {
    ...note,
    commitment: noteCommitment(note),
    ephemeralSecret,
    nonce,
    envelope,
    envelopeHash: poseidon2Hash([1008n, ...envelope]),
  };
}

export function decryptOutputNote(
  envelope: bigint[],
  viewingSecret: bigint,
  domain: bigint,
  expectedCommitment?: bigint,
  expectedSpendPublicKey?: bigint,
): PrivateNote | null {
  if (envelope.length !== 15 || envelope[0] !== 1n) return null;
  const ephemeralPublicKey: Point = [envelope[1], envelope[2]];
  const nonce = envelope[3];
  const sharedSecret = multiplyPoint(
    multiplyPoint(ephemeralPublicKey, viewingSecret),
    8n,
  );
  for (let outputIndex = 0; outputIndex < 4; outputIndex++) {
    const plaintext = envelope.slice(4, 14).map((value, index) =>
      modField(value - poseidon2Hash([
        1006n,
        sharedSecret[0],
        sharedSecret[1],
        nonce,
        BigInt(outputIndex),
        BigInt(index),
      ]))
    );
    const authentication = poseidon2Hash([
      1007n,
      sharedSecret[0],
      sharedSecret[1],
      nonce,
      BigInt(outputIndex),
      ...plaintext,
    ]);
    if (authentication !== envelope[14]) continue;
    const noteBase = {
      noteDomain: domain,
      purpose: plaintext[0],
      amount: plaintext[1],
      spendPublicKey: plaintext[2],
      viewingPublicKey: [plaintext[3], plaintext[4]] as Point,
      noteId: plaintext[5],
      payloadHash: plaintext[6],
      privateData: [plaintext[7], plaintext[8]] as Point,
      blinding: plaintext[9],
    };
    if (
      noteBase.viewingPublicKey[0] !== viewingPublicKey(viewingSecret)[0] ||
      noteBase.viewingPublicKey[1] !== viewingPublicKey(viewingSecret)[1] ||
      (
        expectedSpendPublicKey !== undefined &&
        noteBase.spendPublicKey !== expectedSpendPublicKey
      )
    ) {
      return null;
    }
    const commitment = noteCommitment(noteBase);
    if (
      expectedCommitment !== undefined &&
      commitment !== expectedCommitment
    ) {
      return null;
    }
    return { ...noteBase, commitment };
  }
  return null;
}

export function decryptAllocationWitness(
  envelope: bigint[],
  sharedSecret: Point,
): PrivateAllocationWitness {
  if (envelope.length !== 20 || envelope[0] !== 1n) {
    throw new Error("Private allocation witness has an invalid envelope");
  }
  const nonce = envelope[1];
  const plaintext = envelope.slice(2, -1).map((value, index) =>
    modField(value - poseidon2Hash([
      1014n,
      sharedSecret[0],
      sharedSecret[1],
      nonce,
      BigInt(index),
    ]))
  );
  const authentication = poseidon2Hash([
    1015n,
    sharedSecret[0],
    sharedSecret[1],
    nonce,
    ...plaintext,
  ]);
  if (authentication !== envelope[19]) {
    throw new Error("Private allocation witness authentication failed");
  }
  const leafIndex = Number(plaintext[10]);
  if (
    plaintext[0] !== 1n ||
    !Number.isSafeInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= 64 ||
    plaintext.length !== 17
  ) {
    throw new Error("Private allocation witness is invalid");
  }
  return {
    format: plaintext[0],
    market: [plaintext[1], plaintext[2]],
    epoch: plaintext[3],
    sequence: plaintext[4],
    positionCommitment: plaintext[5],
    side: plaintext[6],
    charge: plaintext[7],
    fee: plaintext[8],
    payout: plaintext[9],
    leafIndex,
    siblings: plaintext.slice(11),
  };
}

export function merkleNode(left: bigint, right: bigint): bigint {
  return poseidon2Hash([1005n, left, right]);
}

export function zeroRoots(levels: number): bigint[] {
  const roots = [0n];
  for (let level = 0; level < levels; level++) {
    roots.push(merkleNode(roots[level], roots[level]));
  }
  return roots;
}

export function merkleTree(commitments: bigint[], levels: number): PrivateTree {
  if (commitments.length > 2 ** levels) throw new Error("Private tree is full");
  const zeros = zeroRoots(levels);
  const layers = [commitments];
  for (let level = 0; level < levels; level++) {
    const current = layers[level];
    const next: bigint[] = [];
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
    levels,
    count: commitments.length,
    root: layers[levels][0],
    layers,
    zeros,
  };
}

export function membershipPath(tree: PrivateTree, leafIndex: number): bigint[] {
  if (leafIndex < 0 || leafIndex >= tree.count) {
    throw new Error("Private note is outside the tree");
  }
  const siblings: bigint[] = [];
  let index = leafIndex;
  for (let level = 0; level < tree.levels; level++) {
    siblings.push(tree.layers[level][index ^ 1] ?? tree.zeros[level]);
    index = Math.floor(index / 2);
  }
  return siblings;
}

export function appendPair(
  tree: PrivateTree,
  commitments: [bigint, bigint],
): { appendRoot: bigint; newRoot: bigint; siblings: bigint[]; firstLeafIndex: number } {
  if (tree.count % 2 !== 0) throw new Error("Private tree append index is invalid");
  if (tree.count + 2 > 2 ** tree.levels) throw new Error("Private tree is full");
  const siblings: bigint[] = [];
  let subtreeIndex = tree.count / 2;
  let node = merkleNode(commitments[0], commitments[1]);
  for (let level = 1; level < tree.levels; level++) {
    const sibling = tree.layers[level][subtreeIndex ^ 1] ?? tree.zeros[level];
    siblings.push(sibling);
    node = (subtreeIndex & 1) === 0
      ? merkleNode(node, sibling)
      : merkleNode(sibling, node);
    subtreeIndex = Math.floor(subtreeIndex / 2);
  }
  return {
    appendRoot: tree.root,
    newRoot: node,
    siblings,
    firstLeafIndex: tree.count,
  };
}

export function appendFour(
  tree: PrivateTree,
  commitments: [bigint, bigint, bigint, bigint],
): {
  appendRoot: bigint;
  middleRoot: bigint;
  newRoot: bigint;
  siblings0: bigint[];
  siblings1: bigint[];
  firstLeafIndex: number;
} {
  const first = appendPair(tree, [commitments[0], commitments[1]]);
  const middleTree = merkleTree(
    [...tree.layers[0], commitments[0], commitments[1]],
    tree.levels,
  );
  if (middleTree.root !== first.newRoot) {
    throw new Error("Private four-note append failed at the middle root");
  }
  const second = appendPair(middleTree, [commitments[2], commitments[3]]);
  return {
    appendRoot: first.appendRoot,
    middleRoot: first.newRoot,
    newRoot: second.newRoot,
    siblings0: first.siblings,
    siblings1: second.siblings,
    firstLeafIndex: first.firstLeafIndex,
  };
}

export function appendOne(
  tree: PrivateTree,
  commitment: bigint,
): { appendRoot: bigint; newRoot: bigint; siblings: bigint[]; leafIndex: number } {
  if (tree.count >= 2 ** tree.levels) throw new Error("Private tree is full");
  const siblings: bigint[] = [];
  let index = tree.count;
  let node = commitment;
  for (let level = 0; level < tree.levels; level++) {
    const sibling = tree.layers[level][index ^ 1] ?? tree.zeros[level];
    siblings.push(sibling);
    node = (index & 1) === 0
      ? merkleNode(node, sibling)
      : merkleNode(sibling, node);
    index = Math.floor(index / 2);
  }
  return {
    appendRoot: tree.root,
    newRoot: node,
    siblings,
    leafIndex: tree.count,
  };
}

export function bytes32Limbs(value: Uint8Array): Point {
  if (value.length !== 32) throw new Error("Expected 32 bytes");
  return [
    bytesToBigInt(value.slice(0, 16)),
    bytesToBigInt(value.slice(16)),
  ];
}

export async function addressLimbs(address: string): Promise<Point> {
  const encoded = new Address(address).toScVal().toXDR();
  const input = new Uint8Array(encoded);
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    input.buffer,
  ));
  return bytes32Limbs(digest);
}

export function bytesToBigInt(value: Uint8Array): bigint {
  const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex || "0"}`);
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/iu.test(value)) throw new Error("Expected a 32-byte hex value");
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function fieldsToEnvelope(fields: bigint[]): Uint8Array {
  if (fields.length !== 15) throw new Error("Private envelope has the wrong size");
  const bytes = new Uint8Array(15 * 32);
  fields.forEach((field, index) => {
    const encoded = field.toString(16).padStart(64, "0");
    bytes.set(Uint8Array.from(encoded.match(/.{2}/gu) ?? [], (byte) =>
      Number.parseInt(byte, 16)
    ), index * 32);
  });
  return bytes;
}

export function envelopeToFields(value: string | Uint8Array): bigint[] {
  const bytes = typeof value === "string"
    ? Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16))
    : value;
  if (bytes.length !== 15 * 32) throw new Error("Private envelope has the wrong size");
  return Array.from({ length: 15 }, (_, index) =>
    bytesToBigInt(bytes.slice(index * 32, (index + 1) * 32))
  );
}

export function randomPrivateScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return bytesToBigInt(bytes) || 1n;
}

export async function operationContextFields({
  networkDomain,
  vault,
  token,
  verifierDomain,
  action,
  actionId,
  publicAccount,
  publicAmount,
  market,
  expiry,
  bindingKind,
  bindingFields,
}: {
  networkDomain: string;
  vault: string;
  token: string;
  verifierDomain: string;
  action: bigint;
  actionId: string;
  publicAccount?: string;
  publicAmount: bigint;
  market?: string;
  expiry: bigint;
  bindingKind: bigint;
  bindingFields?: bigint[];
}): Promise<bigint[]> {
  const publicAccountFields = publicAccount
    ? [1n, ...await addressLimbs(publicAccount)]
    : [0n, 0n, 0n];
  const marketFields = market
    ? [1n, ...await addressLimbs(market)]
    : [0n, 0n, 0n];
  const binding = bindingFields ?? Array<bigint>(24).fill(0n);
  if (binding.length !== 24) throw new Error("Private binding has the wrong size");
  const fields = [
    1n,
    ...bytes32Limbs(hexToBytes(networkDomain)),
    ...await addressLimbs(vault),
    ...await addressLimbs(token),
    ...bytes32Limbs(hexToBytes(verifierDomain)),
    action,
    ...bytes32Limbs(hexToBytes(actionId)),
    ...publicAccountFields,
    publicAmount < 0n ? 1n : 0n,
    publicAmount < 0n ? -publicAmount : publicAmount,
    ...marketFields,
    expiry,
    bindingKind,
    ...binding,
  ];
  if (fields.length !== 46) throw new Error("Private context has the wrong size");
  return fields;
}
