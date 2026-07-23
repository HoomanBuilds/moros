import { writeFileSync } from "node:fs";
import {
  addPoints,
  appendFirstPair,
  appendSecondPair,
  decimalJson,
  firstPairMembershipPaths,
  merkleNode,
  mod,
  multiplyPoint,
  noteCommitment,
  noteDomain,
  noteNullifier,
  outputNote,
  poseidon2Hash,
  spendPublicKey,
  viewingPublicKey,
  zeroRoots,
} from "./privacy-fixture-lib.mjs";

const LEVELS = 20;
const ACCEPTED_LEVELS = 6;
const SCALE = 1n << 32n;
const ATOMIC_SCALE = 10_000_000n;
const BASE8 = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function inputNote({
  domain,
  purpose,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  blinding,
}) {
  const note = {
    noteDomain: domain,
    purpose,
    amount,
    spendPublicKey: spendPublicKey(spendSecret),
    viewingPublicKey: viewingPublicKey(viewingSecret),
    noteId,
    payloadHash: 0n,
    privateData: [0n, 0n],
    blinding,
  };
  return {
    ...note,
    spendSecret,
    commitment: noteCommitment(note),
  };
}

function acceptedRoot(leaf, siblings, index) {
  let node = leaf;
  let position = BigInt(index);
  for (const sibling of siblings) {
    node = (position & 1n) === 0n
      ? merkleNode(node, sibling)
      : merkleNode(sibling, node);
    position >>= 1n;
  }
  return node;
}

const commonContext = [
  1n,
  1n,
  2n,
  3n,
  4n,
  5n,
  6n,
  7n,
  8n,
  3n,
  101n,
  102n,
  0n,
  0n,
  0n,
  0n,
  0n,
  1n,
  20n,
  21n,
  10_000n,
  2n,
  ...Array(24).fill(0n),
];
const domain = noteDomain(commonContext);
const inputs = [
  inputNote({
    domain,
    purpose: 1n,
    amount: 40_000_000n,
    spendSecret: 11n,
    viewingSecret: 12n,
    noteId: 13n,
    blinding: 14n,
  }),
  inputNote({
    domain,
    purpose: 0n,
    amount: 0n,
    spendSecret: 21n,
    viewingSecret: 22n,
    noteId: 23n,
    blinding: 24n,
  }),
];
const inputCommitments = inputs.map((note) => note.commitment);
const activeInputs = inputs.slice(0, 1);
const membership = appendFirstPair(inputCommitments, LEVELS);
const inputPaths = firstPairMembershipPaths(inputCommitments, LEVELS);
const lot = SCALE;
const feeBps = 400n;
const payout = ceilDiv(lot * ATOMIC_SCALE, SCALE);
const maximumFee = ceilDiv(lot * feeBps * ATOMIC_SCALE, SCALE * 40_000n);
const quantity = 3n;
const positionBudget = (payout + maximumFee) * quantity;
const side = 1n;
const sequence = 1n;
const rules = [31n, 32n];
const positionPayload = poseidon2Hash([1010n, 20n, 21n, 0n, ...rules, lot]);
const outputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 40_000_000n - positionBudget,
    spendSecret: 51n,
    viewingSecret: 52n,
    noteId: 53n,
    blinding: 54n,
    ephemeralSecret: 55n,
    nonce: 56n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 2n,
    amount: positionBudget,
    spendSecret: 61n,
    viewingSecret: 62n,
    noteId: 63n,
    payloadHash: positionPayload,
    privateData: [side, sequence * 1_024n + quantity],
    blinding: 64n,
    ephemeralSecret: 65n,
    nonce: 66n,
  }),
];
const noteAppend = appendSecondPair(inputCommitments, outputs.map((note) => note.commitment), LEVELS);
const yesEncryptionRandomness = 71n;
const noEncryptionRandomness = 72n;
const committeePublicKey = BASE8;
const yesC1 = multiplyPoint(BASE8, yesEncryptionRandomness);
const yesShared = multiplyPoint(multiplyPoint(committeePublicKey, 8n), yesEncryptionRandomness);
const yesMessage = multiplyPoint(BASE8, side === 1n ? quantity : 0n);
const yesC2 = addPoints(yesShared, yesMessage);
const noC1 = multiplyPoint(BASE8, noEncryptionRandomness);
const noShared = multiplyPoint(multiplyPoint(committeePublicKey, 8n), noEncryptionRandomness);
const noMessage = multiplyPoint(BASE8, side === 0n ? quantity : 0n);
const noC2 = addPoints(noShared, noMessage);
const ciphertext = [...yesC1, ...yesC2, ...noC1, ...noC2];
const acceptedSiblings = zeroRoots(ACCEPTED_LEVELS).slice(0, ACCEPTED_LEVELS);
const acceptedLeaf = poseidon2Hash([
  1009n,
  20n,
  21n,
  0n,
  sequence,
  101n,
  102n,
  outputs[1].commitment,
  ...ciphertext,
  1n,
]);
const oldAcceptedRoot = zeroRoots(ACCEPTED_LEVELS)[ACCEPTED_LEVELS];
const newAcceptedRoot = acceptedRoot(acceptedLeaf, acceptedSiblings, 0);
const contextFields = [...commonContext];
const binding = [
  0n,
  0n,
  outputs[1].commitment,
  lot,
  feeBps,
  8n,
  2n,
  SCALE / 4n,
  ...rules,
  10_000n,
  1n,
  41n,
  42n,
  ...committeePublicKey,
  poseidon2Hash([1016n, ...ciphertext]),
  oldAcceptedRoot,
  newAcceptedRoot,
  0n,
  sequence,
  0n,
  0n,
  0n,
];
binding.forEach((value, index) => {
  contextFields[22 + index] = value;
});

const fixture = {
  action: "3",
  contextDigest: poseidon2Hash(contextFields),
  membershipRoot: membership.newRoot,
  appendRoot: noteAppend.appendRoot,
  newRoot: noteAppend.newRoot,
  nullifierCount: "1",
  nullifier0: noteNullifier(activeInputs[0], activeInputs[0].spendSecret),
  nullifier1: "0",
  outputCommitment0: outputs[0].commitment,
  outputCommitment1: outputs[1].commitment,
  outputEnvelopeHash0: outputs[0].envelopeHash,
  outputEnvelopeHash1: outputs[1].envelopeHash,
  firstLeafIndex: "2",
  publicAmountSign: "0",
  publicAmountMagnitude: "0",
  contextFields,
  side,
  quantity,
  yesEncryptionRandomness,
  noEncryptionRandomness,
  ciphertext,
  acceptedSiblings,
  inPurpose: activeInputs.map((note) => note.purpose),
  inAmount: activeInputs.map((note) => note.amount),
  inSpendSecret: activeInputs.map((note) => note.spendSecret),
  inViewingPublicKey: activeInputs.map((note) => note.viewingPublicKey),
  inNoteId: activeInputs.map((note) => note.noteId),
  inPayloadHash: activeInputs.map((note) => note.payloadHash),
  inPrivateData: activeInputs.map((note) => note.privateData),
  inBlinding: activeInputs.map((note) => note.blinding),
  inLeafIndex: ["0"],
  inSiblings: inputPaths.slice(0, 1),
  outPurpose: outputs.map((note) => note.purpose),
  outAmount: outputs.map((note) => note.amount),
  outSpendPublicKey: outputs.map((note) => note.spendPublicKey),
  outViewingPublicKey: outputs.map((note) => note.viewingPublicKey),
  outNoteId: outputs.map((note) => note.noteId),
  outPayloadHash: outputs.map((note) => note.payloadHash),
  outPrivateData: outputs.map((note) => note.privateData),
  outBlinding: outputs.map((note) => note.blinding),
  outEphemeralSecret: outputs.map((note) => note.ephemeralSecret),
  outNonce: outputs.map((note) => note.nonce),
  outEnvelope: outputs.map((note) => note.envelope.map(mod)),
  appendSiblings: noteAppend.siblings,
};

writeFileSync(new URL("order.json", import.meta.url), decimalJson(fixture));
