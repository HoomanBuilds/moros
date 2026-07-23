import { writeFileSync } from "node:fs";
import {
  appendFirstPair,
  appendSecondPair,
  decimalJson,
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
const LIQUIDITY_ADDRESS = [20n, 21n];

function inputNote({
  domain,
  purpose,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  payloadHash,
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
    privateData: [0n, 0n],
    blinding,
  };
  return {
    ...note,
    spendSecret,
    commitment: noteCommitment(note),
  };
}

function buildFixture({
  action,
  publicAmount,
  shares,
  version,
  inputs,
  outputs,
  nullifierDomain,
}) {
  const inputCommitments = inputs.map((note) => note.commitment);
  const membership = appendFirstPair(inputCommitments, LEVELS);
  const paths = firstPairMembershipPaths(inputCommitments, LEVELS);
  const append = appendSecondPair(
    inputCommitments,
    outputs.map((note) => note.commitment),
    LEVELS,
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
    101n + action,
    201n + action,
    0n,
    0n,
    0n,
    action === 6n ? 1n : 0n,
    publicAmount,
    1n,
    ...LIQUIDITY_ADDRESS,
    10_000n,
    1n,
    ...LIQUIDITY_ADDRESS,
    outputs[1].commitment,
    shares,
    publicAmount,
    version,
    ...Array(18).fill(0n),
  ];
  return {
    action,
    contextDigest: poseidon2Hash(contextFields),
    membershipRoot: membership.newRoot,
    appendRoot: append.appendRoot,
    newRoot: append.newRoot,
    nullifierCount: 2n,
    nullifier0: noteNullifier(inputs[0], inputs[0].spendSecret, nullifierDomain),
    nullifier1: noteNullifier(inputs[1], inputs[1].spendSecret, nullifierDomain),
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: 2n,
    publicAmountSign: action === 6n ? 1n : 0n,
    publicAmountMagnitude: publicAmount,
    contextFields,
    inPurpose: inputs.map((note) => note.purpose),
    inAmount: inputs.map((note) => note.amount),
    inSpendSecret: inputs.map((note) => note.spendSecret),
    inViewingPublicKey: inputs.map((note) => note.viewingPublicKey),
    inNoteId: inputs.map((note) => note.noteId),
    inPayloadHash: inputs.map((note) => note.payloadHash),
    inPrivateData: inputs.map((note) => note.privateData),
    inBlinding: inputs.map((note) => note.blinding),
    inLeafIndex: [0n, 1n],
    inSiblings: paths,
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

const baseContext = [1n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
const domain = noteDomain(baseContext);
const liquidityPayload = poseidon2Hash([1011n, ...LIQUIDITY_ADDRESS]);

const fundInputs = [
  inputNote({
    domain,
    purpose: 1n,
    amount: 20_000_000n,
    spendSecret: 11n,
    viewingSecret: 12n,
    noteId: 13n,
    payloadHash: 0n,
    blinding: 14n,
  }),
  inputNote({
    domain,
    purpose: 1n,
    amount: 10_000_000n,
    spendSecret: 21n,
    viewingSecret: 22n,
    noteId: 23n,
    payloadHash: 0n,
    blinding: 24n,
  }),
];
const fundOutputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 10_000_000n,
    spendSecret: 31n,
    viewingSecret: 32n,
    noteId: 33n,
    blinding: 34n,
    ephemeralSecret: 35n,
    nonce: 36n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 3n,
    amount: 19_000_000n,
    spendSecret: 41n,
    viewingSecret: 42n,
    noteId: 43n,
    payloadHash: liquidityPayload,
    blinding: 44n,
    ephemeralSecret: 45n,
    nonce: 46n,
  }),
];
const fund = buildFixture({
  action: 6n,
  publicAmount: 20_000_000n,
  shares: 19_000_000n,
  version: 0n,
  inputs: fundInputs,
  outputs: fundOutputs,
  nullifierDomain: 1n,
});

const exitInputs = [
  inputNote({
    domain,
    purpose: 3n,
    amount: 12_000_000n,
    spendSecret: 51n,
    viewingSecret: 52n,
    noteId: 53n,
    payloadHash: liquidityPayload,
    blinding: 54n,
  }),
  inputNote({
    domain,
    purpose: 3n,
    amount: 8_000_000n,
    spendSecret: 61n,
    viewingSecret: 62n,
    noteId: 63n,
    payloadHash: liquidityPayload,
    blinding: 64n,
  }),
];
const exitOutputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 9_000_000n,
    spendSecret: 71n,
    viewingSecret: 72n,
    noteId: 73n,
    blinding: 74n,
    ephemeralSecret: 75n,
    nonce: 76n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 3n,
    amount: 13_000_000n,
    spendSecret: 81n,
    viewingSecret: 82n,
    noteId: 83n,
    payloadHash: liquidityPayload,
    blinding: 84n,
    ephemeralSecret: 85n,
    nonce: 86n,
  }),
];
const exit = buildFixture({
  action: 7n,
  publicAmount: 9_000_000n,
  shares: 7_000_000n,
  version: 1n,
  inputs: exitInputs,
  outputs: exitOutputs,
  nullifierDomain: 2n,
});

const redeemOutputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 21_000_000n,
    spendSecret: 91n,
    viewingSecret: 92n,
    noteId: 93n,
    blinding: 94n,
    ephemeralSecret: 95n,
    nonce: 96n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 0n,
    amount: 0n,
    spendSecret: 101n,
    viewingSecret: 102n,
    noteId: 103n,
    blinding: 104n,
    ephemeralSecret: 105n,
    nonce: 106n,
  }),
];
const redeem = buildFixture({
  action: 8n,
  publicAmount: 21_000_000n,
  shares: 20_000_000n,
  version: 2n,
  inputs: exitInputs,
  outputs: redeemOutputs,
  nullifierDomain: 2n,
});

for (const [name, fixture] of [
  ["liquidity_fund", fund],
  ["liquidity_exit", exit],
  ["liquidity_redeem", redeem],
]) {
  writeFileSync(new URL(`${name}.json`, import.meta.url), `${decimalJson(fixture)}\n`);
}
