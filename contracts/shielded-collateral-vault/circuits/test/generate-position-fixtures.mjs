import { writeFileSync } from "node:fs";
import {
  appendFirstPair,
  appendSecondPair,
  decimalJson,
  firstPairMembershipPaths,
  merkleNode,
  noteCommitment,
  noteDomain,
  noteNullifier,
  outputNote,
  poseidon2Hash,
  spendPublicKey,
  viewingPublicKey,
  zeroRoots,
} from "./privacy-fixture-lib.mjs";

const NOTE_LEVELS = 20;
const ROOT_LEVELS = 6;
const SCALE = 1n << 32n;
const MARKET = [20n, 21n];
const EPOCH = 0n;
const SEQUENCE = 5n;
const SIDE = 1n;
const PAYOUT = 10_000_000n;
const YES_CHARGE = 4_000_000n;
const NO_CHARGE = 5_000_000n;
const FEE = 200_000n;
const POSITION_BUDGET = 10_500_000n;
const ACCEPTED_ACTION = [111n, 112n];
const ACCEPTED_CIPHERTEXT = [121n, 122n, 123n, 124n];
const COMMITTEE_EPOCH = 1n;

function inputNote({
  domain,
  purpose,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  payloadHash,
  privateData,
  blinding,
}) {
  const note = {
    noteDomain: domain,
    purpose,
    amount,
    spendPublicKey: spendPublicKey(spendSecret),
    viewingPublicKey: viewingPublicKey(viewingSecret),
    noteId,
    payloadHash,
    privateData,
    blinding,
  };
  return {
    ...note,
    spendSecret,
    commitment: noteCommitment(note),
  };
}

function rootAtZero(leaf) {
  const siblings = zeroRoots(ROOT_LEVELS).slice(0, ROOT_LEVELS);
  let root = leaf;
  for (const sibling of siblings) {
    root = merkleNode(root, sibling);
  }
  return { root, siblings };
}

const baseContext = [1n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
const domain = noteDomain(baseContext);
const position = inputNote({
  domain,
  purpose: 2n,
  amount: POSITION_BUDGET,
  spendSecret: 11n,
  viewingSecret: 12n,
  noteId: 13n,
  payloadHash: 999n,
  privateData: [SIDE, SEQUENCE],
  blinding: 14n,
});
const padding = inputNote({
  domain,
  purpose: 0n,
  amount: 0n,
  spendSecret: 21n,
  viewingSecret: 22n,
  noteId: 23n,
  payloadHash: 0n,
  privateData: [0n, 0n],
  blinding: 24n,
});
const inputCommitments = [position.commitment, padding.commitment];
const membership = appendFirstPair(inputCommitments, NOTE_LEVELS);
const membershipPaths = firstPairMembershipPaths(inputCommitments, NOTE_LEVELS);

const acceptedLeaf = poseidon2Hash([
  1009n,
  ...MARKET,
  EPOCH,
  SEQUENCE,
  ...ACCEPTED_ACTION,
  position.commitment,
  ...ACCEPTED_CIPHERTEXT,
  COMMITTEE_EPOCH,
]);
const accepted = rootAtZero(acceptedLeaf);
const allocationLeaf = poseidon2Hash([
  1012n,
  ...MARKET,
  EPOCH,
  SEQUENCE,
  position.commitment,
  SIDE,
  YES_CHARGE,
  FEE,
  PAYOUT,
]);
const allocation = rootAtZero(allocationLeaf);

function allocationBinding(outcome) {
  return [
    EPOCH,
    allocation.root,
    outcome,
    0n,
    8n,
    4n,
    4n,
    SCALE / 2n,
    SCALE / 2n,
    SCALE / 2n,
    SCALE / 2n,
    36_000_000n,
    16_000_000n,
    20_000_000n,
    YES_CHARGE,
    NO_CHARGE,
    0n,
    FEE,
    1_600_000n,
    800_000n,
    800_000n,
    SCALE,
    0n,
    0n,
  ];
}

function createFixture({
  name,
  action,
  binding,
  outputPurpose,
  outputAmount,
  nullifierDomain,
  acceptedMode,
}) {
  const outputs = [
    outputNote({
      outputIndex: 0,
      noteDomain: domain,
      purpose: outputPurpose,
      amount: outputAmount,
      spendSecret: 31n + action,
      viewingSecret: 41n + action,
      noteId: 51n + action,
      blinding: 61n + action,
      ephemeralSecret: 71n + action,
      nonce: 81n + action,
    }),
    outputNote({
      outputIndex: 1,
      noteDomain: domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: 91n + action,
      viewingSecret: 101n + action,
      noteId: 111n + action,
      blinding: 121n + action,
      ephemeralSecret: 131n + action,
      nonce: 141n + action,
    }),
  ];
  const append = appendSecondPair(
    inputCommitments,
    outputs.map((note) => note.commitment),
    NOTE_LEVELS,
  );
  const contextFields = [
    1n,
    1n,
    2n,
    3n,
    4n,
    5n,
    6n,
    7n,
    8n,
    action,
    301n + action,
    401n + action,
    0n,
    0n,
    0n,
    0n,
    0n,
    1n,
    ...MARKET,
    10_000n,
    acceptedMode ? 3n : 4n,
    ...binding,
  ];
  const fixture = {
    action,
    contextDigest: poseidon2Hash(contextFields),
    membershipRoot: membership.newRoot,
    appendRoot: append.appendRoot,
    newRoot: append.newRoot,
    nullifierCount: 1n,
    nullifier0: noteNullifier(position, position.spendSecret, nullifierDomain),
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: 2n,
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    acceptedActionId: ACCEPTED_ACTION,
    acceptedCiphertext: ACCEPTED_CIPHERTEXT,
    acceptedCommitteeEpoch: COMMITTEE_EPOCH,
    acceptedLeafIndex: 0n,
    acceptedSiblings: accepted.siblings,
    allocationLeafIndex: 0n,
    allocationSiblings: allocation.siblings,
    inPurpose: position.purpose,
    inAmount: position.amount,
    inSpendSecret: position.spendSecret,
    inViewingPublicKey: position.viewingPublicKey,
    inNoteId: position.noteId,
    inPayloadHash: position.payloadHash,
    inPrivateData: position.privateData,
    inBlinding: position.blinding,
    inLeafIndex: 0n,
    inSiblings: membershipPaths[0],
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
    outEnvelope: outputs.map((note) => note.envelope),
    appendSiblings: append.siblings,
  };
  writeFileSync(new URL(`${name}.json`, import.meta.url), `${decimalJson(fixture)}\n`);
}

createFixture({
  name: "execution_change",
  action: 9n,
  binding: allocationBinding(0n),
  outputPurpose: 1n,
  outputAmount: POSITION_BUDGET - YES_CHARGE - FEE,
  nullifierDomain: 3n,
  acceptedMode: false,
});
createFixture({
  name: "claim",
  action: 4n,
  binding: allocationBinding(1n),
  outputPurpose: 7n,
  outputAmount: PAYOUT,
  nullifierDomain: 4n,
  acceptedMode: false,
});
createFixture({
  name: "refund",
  action: 5n,
  binding: [EPOCH, accepted.root, ...Array(22).fill(0n)],
  outputPurpose: 6n,
  outputAmount: POSITION_BUDGET,
  nullifierDomain: 4n,
  acceptedMode: true,
});
createFixture({
  name: "void_refund",
  action: 5n,
  binding: allocationBinding(3n),
  outputPurpose: 6n,
  outputAmount: YES_CHARGE + FEE,
  nullifierDomain: 4n,
  acceptedMode: false,
});
