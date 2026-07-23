import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendFirstPair,
  appendFourthPair,
  appendSecondPair,
  appendThirdPair,
  decimalJson,
  firstFourMembershipPaths,
  firstPairMembershipPaths,
  noteCommitment,
  noteDomain,
  noteNullifier,
  outputNote,
  poseidon2Hash,
  spendPublicKey,
  viewingPublicKey,
} from "./privacy-fixture-lib.mjs";

const LEVELS = 20;
const BASE_CONTEXT = [1n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
const LIQUIDITY = [20n, 21n];
const MARKET = [30n, 31n];
const EXIT_ID = [40n, 41n];
const domain = noteDomain(BASE_CONTEXT);
const liquidityPayload = poseidon2Hash([1011n, ...LIQUIDITY]);
const exitPayload = poseidon2Hash([1014n, ...LIQUIDITY, ...EXIT_ID]);
const mask128 = (1n << 128n) - 1n;

function limbs(value) {
  return [value >> 128n, value & mask128];
}

function inputNote({
  purpose,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  payloadHash = 0n,
  privateData = [0n, 0n],
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

function context(action, kind, binding, actionExpiry = 9_200n) {
  const fields = [
    ...BASE_CONTEXT,
    action,
    101n + action,
    201n + action,
    0n,
    0n,
    0n,
    0n,
    0n,
    1n,
    ...MARKET,
    actionExpiry,
    kind,
    ...binding,
  ];
  if (fields.length !== 46) throw new Error("invalid context shape");
  return fields;
}

function standardFixture({
  action,
  contextFields,
  inputs,
  inputPaths,
  inputIndexes,
  nullifierDomain,
  outputs,
  append,
}) {
  const nullifiers = inputs.map((note) =>
    noteNullifier(note, note.spendSecret, nullifierDomain),
  );
  return {
    action,
    contextDigest: poseidon2Hash(contextFields),
    membershipRoot: append.appendRoot,
    appendRoot: append.appendRoot,
    newRoot: append.newRoot,
    nullifierCount: BigInt(inputs.length),
    nullifier0: nullifiers[0],
    nullifier1: nullifiers[1] ?? 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: 2n,
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    inPurpose: inputs.map((note) => note.purpose),
    inAmount: inputs.map((note) => note.amount),
    inSpendSecret: inputs.map((note) => note.spendSecret),
    inViewingPublicKey: inputs.map((note) => note.viewingPublicKey),
    inNoteId: inputs.map((note) => note.noteId),
    inPayloadHash: inputs.map((note) => note.payloadHash),
    inPrivateData: inputs.map((note) => note.privateData),
    inBlinding: inputs.map((note) => note.blinding),
    inLeafIndex: inputIndexes,
    inSiblings: inputPaths,
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
}

const requestInputs = [
  inputNote({
    purpose: 3n,
    amount: 20_000_000n,
    spendSecret: 11n,
    viewingSecret: 12n,
    noteId: 13n,
    payloadHash: liquidityPayload,
    blinding: 14n,
  }),
  inputNote({
    purpose: 3n,
    amount: 10_000_000n,
    spendSecret: 21n,
    viewingSecret: 22n,
    noteId: 23n,
    payloadHash: liquidityPayload,
    blinding: 24n,
  }),
];
const requestOutputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 0n,
    amount: 0n,
    spendSecret: 31n,
    viewingSecret: 32n,
    noteId: 33n,
    payloadHash: 0n,
    blinding: 34n,
    ephemeralSecret: 35n,
    nonce: 36n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 9n,
    amount: 20_000_000n,
    spendSecret: 41n,
    viewingSecret: 42n,
    noteId: 43n,
    payloadHash: exitPayload,
    privateData: [16_000_000n, 9_000n],
    blinding: 44n,
    ephemeralSecret: 45n,
    nonce: 46n,
  }),
];
const requestMembership = appendFirstPair(
  requestInputs.map((note) => note.commitment),
  LEVELS,
);
const requestAppend = appendSecondPair(
  requestInputs.map((note) => note.commitment),
  requestOutputs.map((note) => note.commitment),
  LEVELS,
);
const requestBinding = [
  ...LIQUIDITY,
  ...EXIT_ID,
  20_000_000n,
  16_000_000n,
  ...limbs(requestOutputs[1].commitment),
  9_000n,
  3n,
  ...Array(14).fill(0n),
];
const request = standardFixture({
  action: 11n,
  contextFields: context(11n, 6n, requestBinding),
  inputs: requestInputs.slice(0, 1),
  inputPaths: firstPairMembershipPaths(
    requestInputs.map((note) => note.commitment),
    LEVELS,
  ).slice(0, 1),
  inputIndexes: [0n],
  nullifierDomain: 2n,
  outputs: requestOutputs,
  append: requestAppend,
});
request.membershipRoot = requestMembership.newRoot;

const cancelTree = appendFirstPair(
  requestOutputs.map((note) => note.commitment),
  LEVELS,
);
const cancelInput = { ...requestOutputs[1], spendSecret: 41n };
const cancelOutputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 3n,
    amount: 20_000_000n,
    spendSecret: 51n,
    viewingSecret: 52n,
    noteId: 53n,
    payloadHash: liquidityPayload,
    blinding: 54n,
    ephemeralSecret: 55n,
    nonce: 56n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 0n,
    amount: 0n,
    spendSecret: 61n,
    viewingSecret: 62n,
    noteId: 63n,
    blinding: 64n,
    ephemeralSecret: 65n,
    nonce: 66n,
  }),
];
const cancelAppend = appendSecondPair(
  requestOutputs.map((note) => note.commitment),
  cancelOutputs.map((note) => note.commitment),
  LEVELS,
);
const cancelBinding = [
  ...LIQUIDITY,
  ...EXIT_ID,
  20_000_000n,
  16_000_000n,
  ...limbs(requestOutputs[1].commitment),
  9_000n,
  4n,
  ...Array(14).fill(0n),
];
const cancel = standardFixture({
  action: 12n,
  contextFields: context(12n, 7n, cancelBinding),
  inputs: [cancelInput],
  inputPaths: [
    firstPairMembershipPaths(
      requestOutputs.map((note) => note.commitment),
      LEVELS,
    )[1],
  ],
  inputIndexes: [1n],
  nullifierDomain: 5n,
  outputs: cancelOutputs,
  append: cancelAppend,
});
cancel.membershipRoot = cancelTree.newRoot;

const sellerSpendSecret = 71n;
const sellerViewingSecret = 72n;
const matchInputs = [
  inputNote({
    purpose: 9n,
    amount: 40_000_000n,
    spendSecret: sellerSpendSecret,
    viewingSecret: sellerViewingSecret,
    noteId: 73n,
    payloadHash: exitPayload,
    privateData: [32_000_000n, 9_000n],
    blinding: 74n,
  }),
  inputNote({
    purpose: 1n,
    amount: 5_000_000n,
    spendSecret: 81n,
    viewingSecret: 82n,
    noteId: 83n,
    blinding: 84n,
  }),
  inputNote({
    purpose: 1n,
    amount: 5_000_000n,
    spendSecret: 91n,
    viewingSecret: 92n,
    noteId: 93n,
    blinding: 94n,
  }),
];
const unspentPadding = inputNote({
  purpose: 0n,
  amount: 0n,
  spendSecret: 101n,
  viewingSecret: 102n,
  noteId: 103n,
  blinding: 104n,
});
const matchTreeCommitments = [
  ...matchInputs.map((note) => note.commitment),
  unspentPadding.commitment,
];
const matchPaths = firstFourMembershipPaths(matchTreeCommitments, LEVELS);
const matchOutputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 8_000_000n,
    spendSecret: sellerSpendSecret,
    viewingSecret: sellerViewingSecret,
    noteId: 111n,
    blinding: 112n,
    ephemeralSecret: 113n,
    nonce: 114n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 3n,
    amount: 10_000_000n,
    spendSecret: 121n,
    viewingSecret: 122n,
    noteId: 123n,
    payloadHash: liquidityPayload,
    blinding: 124n,
    ephemeralSecret: 125n,
    nonce: 126n,
  }),
  outputNote({
    outputIndex: 2,
    noteDomain: domain,
    purpose: 1n,
    amount: 2_000_000n,
    spendSecret: 131n,
    viewingSecret: 132n,
    noteId: 133n,
    blinding: 134n,
    ephemeralSecret: 135n,
    nonce: 136n,
  }),
  outputNote({
    outputIndex: 3,
    noteDomain: domain,
    purpose: 9n,
    amount: 30_000_000n,
    spendSecret: sellerSpendSecret,
    viewingSecret: sellerViewingSecret,
    noteId: 141n,
    payloadHash: exitPayload,
    privateData: [24_000_000n, 9_000n],
    blinding: 142n,
    ephemeralSecret: 143n,
    nonce: 144n,
  }),
];
const firstInputPair = matchTreeCommitments.slice(0, 2);
const secondInputPair = matchTreeCommitments.slice(2, 4);
const firstOutputPair = matchOutputs.slice(0, 2).map((note) => note.commitment);
const secondOutputPair = matchOutputs.slice(2, 4).map((note) => note.commitment);
const appendFirst = appendThirdPair(
  firstInputPair,
  secondInputPair,
  firstOutputPair,
  LEVELS,
);
const appendSecond = appendFourthPair(
  firstInputPair,
  secondInputPair,
  firstOutputPair,
  secondOutputPair,
  LEVELS,
);
const matchBinding = [
  ...LIQUIDITY,
  ...EXIT_ID,
  10_000_000n,
  8_000_000n,
  40_000_000n,
  32_000_000n,
  ...limbs(matchInputs[0].commitment),
  9_000n,
  7n,
  70_000_000n,
  90_000_000n,
  1_000_000n,
  8_500n,
  1_000n,
  5n,
  8_000_000n,
  24_000_000n,
  ...limbs(matchOutputs[3].commitment),
  30_000_000n,
  9_500n,
];
const matchContext = context(13n, 8n, matchBinding);
const match = {
  action: 13n,
  contextDigest: poseidon2Hash(matchContext),
  membershipRoot: appendFirst.appendRoot,
  appendRoot: appendFirst.appendRoot,
  newRoot: appendSecond.newRoot,
  nullifierCount: 3n,
  nullifier0: noteNullifier(matchInputs[0], matchInputs[0].spendSecret, 5n),
  nullifier1: noteNullifier(matchInputs[1], matchInputs[1].spendSecret, 1n),
  nullifier2: noteNullifier(matchInputs[2], matchInputs[2].spendSecret, 1n),
  outputCommitment0: matchOutputs[0].commitment,
  outputCommitment1: matchOutputs[1].commitment,
  outputCommitment2: matchOutputs[2].commitment,
  outputCommitment3: matchOutputs[3].commitment,
  outputEnvelopeHash0: matchOutputs[0].envelopeHash,
  outputEnvelopeHash1: matchOutputs[1].envelopeHash,
  outputEnvelopeHash2: matchOutputs[2].envelopeHash,
  outputEnvelopeHash3: matchOutputs[3].envelopeHash,
  firstLeafIndex: 4n,
  publicAmountSign: 0n,
  publicAmountMagnitude: 0n,
  contextFields: matchContext,
  inPurpose: matchInputs.map((note) => note.purpose),
  inAmount: matchInputs.map((note) => note.amount),
  inSpendSecret: matchInputs.map((note) => note.spendSecret),
  inViewingPublicKey: matchInputs.map((note) => note.viewingPublicKey),
  inNoteId: matchInputs.map((note) => note.noteId),
  inPayloadHash: matchInputs.map((note) => note.payloadHash),
  inPrivateData: matchInputs.map((note) => note.privateData),
  inBlinding: matchInputs.map((note) => note.blinding),
  inLeafIndex: [0n, 1n, 2n],
  inSiblings: matchPaths.slice(0, 3),
  outPurpose: matchOutputs.map((note) => note.purpose),
  outAmount: matchOutputs.map((note) => note.amount),
  outSpendPublicKey: matchOutputs.map((note) => note.spendPublicKey),
  outViewingPublicKey: matchOutputs.map((note) => note.viewingPublicKey),
  outNoteId: matchOutputs.map((note) => note.noteId),
  outPayloadHash: matchOutputs.map((note) => note.payloadHash),
  outPrivateData: matchOutputs.map((note) => note.privateData),
  outBlinding: matchOutputs.map((note) => note.blinding),
  outEphemeralSecret: matchOutputs.map((note) => note.ephemeralSecret),
  outNonce: matchOutputs.map((note) => note.nonce),
  outEnvelope: matchOutputs.map((note) => note.envelope),
  middleRoot: appendFirst.newRoot,
  appendSiblings0: appendFirst.siblings,
  appendSiblings1: appendSecond.siblings,
};

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, "exit_request.json"), `${decimalJson(request)}\n`);
writeFileSync(resolve(here, "exit_cancel.json"), `${decimalJson(cancel)}\n`);
writeFileSync(resolve(here, "exit_match.json"), `${decimalJson(match)}\n`);
