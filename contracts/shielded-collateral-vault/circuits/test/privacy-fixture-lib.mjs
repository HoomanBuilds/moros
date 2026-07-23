import { poseidon2Hash } from "../../../../circuits/node_modules/@zkpassport/poseidon2/dist/esm/index.js";

export { poseidon2Hash };

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const A = 168700n;
const D = 168696n;
const BASE8 = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

export function mod(value) {
  const reduced = value % FIELD;
  return reduced < 0n ? reduced + FIELD : reduced;
}

function power(base, exponent) {
  let result = 1n;
  let current = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = mod(result * current);
    current = mod(current * current);
    remaining >>= 1n;
  }
  return result;
}

function inverse(value) {
  if (mod(value) === 0n) throw new Error("division by zero");
  return power(value, FIELD - 2n);
}

export function addPoints(left, right) {
  const [x1, y1] = left;
  const [x2, y2] = right;
  const product = mod(x1 * x2 * y1 * y2);
  return [
    mod((x1 * y2 + y1 * x2) * inverse(1n + D * product)),
    mod((y1 * y2 - A * x1 * x2) * inverse(1n - D * product)),
  ];
}

export function multiplyPoint(point, scalar) {
  let result = [0n, 1n];
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

export function viewingPublicKey(secret) {
  return multiplyPoint(BASE8, secret);
}

export function spendPublicKey(secret) {
  return poseidon2Hash([1002n, secret]);
}

export function noteDomain(contextFields) {
  return poseidon2Hash([1001n, ...contextFields.slice(1, 9)]);
}

export function noteCommitment(note) {
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

export function noteNullifier(note, spendSecret, nullifierDomain = 1n) {
  return poseidon2Hash([
    1004n,
    note.noteDomain,
    nullifierDomain,
    note.commitment ?? noteCommitment(note),
    spendSecret,
    note.noteId,
  ]);
}

export function outputNote({
  outputIndex,
  noteDomain: domain,
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
}) {
  const recipientSpendPublicKey = spendPublicKey(spendSecret);
  const recipientViewingPublicKey = viewingPublicKey(viewingSecret);
  const ephemeralPublicKey = multiplyPoint(BASE8, ephemeralSecret);
  const cofactorPublicKey = multiplyPoint(recipientViewingPublicKey, 8n);
  const sharedSecret = multiplyPoint(cofactorPublicKey, ephemeralSecret);
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
    mod(
      value +
        poseidon2Hash([
          1006n,
          sharedSecret[0],
          sharedSecret[1],
          nonce,
          BigInt(outputIndex),
          BigInt(index),
        ]),
    ),
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
    ephemeralSecret,
    nonce,
    envelope,
  };
  return {
    ...note,
    commitment: noteCommitment(note),
    envelopeHash: poseidon2Hash([1008n, ...envelope]),
  };
}

export function merkleNode(left, right) {
  return poseidon2Hash([1005n, left, right]);
}

export function zeroRoots(levels) {
  const roots = [0n];
  for (let level = 0; level < levels; level++) {
    roots.push(merkleNode(roots[level], roots[level]));
  }
  return roots;
}

export function appendFirstPair(outputCommitments, levels) {
  const roots = zeroRoots(levels);
  let root = merkleNode(outputCommitments[0], outputCommitments[1]);
  const siblings = [];
  for (let level = 1; level < levels; level++) {
    siblings.push(roots[level]);
    root = merkleNode(root, roots[level]);
  }
  return {
    appendRoot: roots[levels],
    newRoot: root,
    siblings,
  };
}

export function firstPairMembershipPaths(outputCommitments, levels) {
  const roots = zeroRoots(levels);
  return [
    [outputCommitments[1], ...roots.slice(1, levels)],
    [outputCommitments[0], ...roots.slice(1, levels)],
  ];
}

export function appendSecondPair(firstPairCommitments, outputCommitments, levels) {
  const roots = zeroRoots(levels);
  const firstPairRoot = merkleNode(firstPairCommitments[0], firstPairCommitments[1]);
  const secondPairRoot = merkleNode(outputCommitments[0], outputCommitments[1]);
  const siblings = [firstPairRoot, ...roots.slice(2, levels)];
  let newRoot = merkleNode(firstPairRoot, secondPairRoot);
  for (let level = 2; level < levels; level++) {
    newRoot = merkleNode(newRoot, roots[level]);
  }
  const firstTree = appendFirstPair(firstPairCommitments, levels);
  return {
    appendRoot: firstTree.newRoot,
    newRoot,
    siblings,
  };
}

export function secondPairMembershipPaths(firstPairCommitments, secondPairCommitments, levels) {
  const roots = zeroRoots(levels);
  const firstPairRoot = merkleNode(firstPairCommitments[0], firstPairCommitments[1]);
  return [
    [secondPairCommitments[1], firstPairRoot, ...roots.slice(2, levels)],
    [secondPairCommitments[0], firstPairRoot, ...roots.slice(2, levels)],
  ];
}

export function firstFourMembershipPaths(commitments, levels) {
  if (commitments.length !== 4) throw new Error("four commitments required");
  const roots = zeroRoots(levels);
  const firstPairRoot = merkleNode(commitments[0], commitments[1]);
  const secondPairRoot = merkleNode(commitments[2], commitments[3]);
  return [
    [commitments[1], secondPairRoot, ...roots.slice(2, levels)],
    [commitments[0], secondPairRoot, ...roots.slice(2, levels)],
    [commitments[3], firstPairRoot, ...roots.slice(2, levels)],
    [commitments[2], firstPairRoot, ...roots.slice(2, levels)],
  ];
}

export function appendThirdPair(firstPairCommitments, secondPairCommitments, outputs, levels) {
  const roots = zeroRoots(levels);
  const firstPairRoot = merkleNode(firstPairCommitments[0], firstPairCommitments[1]);
  const secondPairRoot = merkleNode(secondPairCommitments[0], secondPairCommitments[1]);
  const firstFourRoot = merkleNode(firstPairRoot, secondPairRoot);
  const thirdPairRoot = merkleNode(outputs[0], outputs[1]);
  const siblings = [roots[1], firstFourRoot, ...roots.slice(3, levels)];
  let newRoot = merkleNode(thirdPairRoot, roots[1]);
  newRoot = merkleNode(firstFourRoot, newRoot);
  for (let level = 3; level < levels; level++) {
    newRoot = merkleNode(newRoot, roots[level]);
  }
  const prior = appendSecondPair(firstPairCommitments, secondPairCommitments, levels);
  return {
    appendRoot: prior.newRoot,
    newRoot,
    siblings,
  };
}

export function appendFourthPair(
  firstPairCommitments,
  secondPairCommitments,
  thirdPairCommitments,
  outputs,
  levels,
) {
  const roots = zeroRoots(levels);
  const firstPairRoot = merkleNode(firstPairCommitments[0], firstPairCommitments[1]);
  const secondPairRoot = merkleNode(secondPairCommitments[0], secondPairCommitments[1]);
  const thirdPairRoot = merkleNode(thirdPairCommitments[0], thirdPairCommitments[1]);
  const fourthPairRoot = merkleNode(outputs[0], outputs[1]);
  const firstFourRoot = merkleNode(firstPairRoot, secondPairRoot);
  const lastFourRoot = merkleNode(thirdPairRoot, fourthPairRoot);
  let newRoot = merkleNode(firstFourRoot, lastFourRoot);
  for (let level = 3; level < levels; level++) {
    newRoot = merkleNode(newRoot, roots[level]);
  }
  const prior = appendThirdPair(
    firstPairCommitments,
    secondPairCommitments,
    thirdPairCommitments,
    levels,
  );
  return {
    appendRoot: prior.newRoot,
    newRoot,
    siblings: [thirdPairRoot, firstFourRoot, ...roots.slice(3, levels)],
  };
}

export function decimalJson(value) {
  return JSON.stringify(
    value,
    (_, field) => (typeof field === "bigint" ? field.toString() : field),
    2,
  );
}
