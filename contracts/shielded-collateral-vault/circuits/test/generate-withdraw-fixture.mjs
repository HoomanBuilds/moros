import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { poseidon2Hash } from "../../../../circuits/node_modules/@zkpassport/poseidon2/dist/esm/index.js";
import {
  appendThirdPair,
  decimalJson,
  noteDomain,
  noteNullifier,
  outputNote,
  secondPairMembershipPaths,
} from "./privacy-fixture-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const parseFields = (_, value) =>
  typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value;
const depositNotes = JSON.parse(
  readFileSync(resolve(here, "deposit_notes.json"), "utf8"),
  parseFields,
);
const inputs = JSON.parse(
  readFileSync(resolve(here, "transfer_notes.json"), "utf8"),
  parseFields,
);
const levels = 20;
const withdrawal = 125_000_000n;
const spendSecrets = [401n];
const contextFields = [
  1n,
  101n,
  102n,
  103n,
  104n,
  105n,
  106n,
  107n,
  108n,
  2n,
  501n,
  502n,
  1n,
  503n,
  504n,
  1n,
  withdrawal,
  0n,
  0n,
  0n,
  1_200n,
  0n,
  ...Array(24).fill(0n),
];
const domain = noteDomain(contextFields);
const outputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 225_000_000n,
    spendSecret: 601n,
    viewingSecret: 602n,
    noteId: 603n,
    blinding: 604n,
    ephemeralSecret: 605n,
    nonce: 606n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 0n,
    amount: 0n,
    spendSecret: 611n,
    viewingSecret: 612n,
    noteId: 613n,
    blinding: 614n,
    ephemeralSecret: 615n,
    nonce: 616n,
  }),
];
const inputCommitments = inputs.map((note) => note.commitment);
const depositCommitments = depositNotes.map((note) => note.commitment);
const inputPaths = secondPairMembershipPaths(depositCommitments, inputCommitments, levels);
const tree = appendThirdPair(
  depositCommitments,
  inputCommitments,
  outputs.map((output) => output.commitment),
  levels,
);
const fixture = {
  action: 2n,
  contextDigest: poseidon2Hash(contextFields),
  membershipRoot: tree.appendRoot,
  appendRoot: tree.appendRoot,
  newRoot: tree.newRoot,
  nullifierCount: 1n,
  nullifier0: noteNullifier(inputs[0], spendSecrets[0]),
  nullifier1: 0n,
  outputCommitment0: outputs[0].commitment,
  outputCommitment1: outputs[1].commitment,
  outputEnvelopeHash0: outputs[0].envelopeHash,
  outputEnvelopeHash1: outputs[1].envelopeHash,
  firstLeafIndex: 4n,
  publicAmountSign: 1n,
  publicAmountMagnitude: withdrawal,
  contextFields,
  inPurpose: inputs.slice(0, 1).map((note) => note.purpose),
  inAmount: inputs.slice(0, 1).map((note) => note.amount),
  inSpendSecret: spendSecrets,
  inViewingPublicKey: inputs.slice(0, 1).map((note) => note.viewingPublicKey),
  inNoteId: inputs.slice(0, 1).map((note) => note.noteId),
  inPayloadHash: inputs.slice(0, 1).map((note) => note.payloadHash),
  inPrivateData: inputs.slice(0, 1).map((note) => note.privateData),
  inBlinding: inputs.slice(0, 1).map((note) => note.blinding),
  inLeafIndex: [2n],
  inSiblings: inputPaths.slice(0, 1),
  outPurpose: outputs.map((output) => output.purpose),
  outAmount: outputs.map((output) => output.amount),
  outSpendPublicKey: outputs.map((output) => output.spendPublicKey),
  outViewingPublicKey: outputs.map((output) => output.viewingPublicKey),
  outNoteId: outputs.map((output) => output.noteId),
  outPayloadHash: outputs.map((output) => output.payloadHash),
  outPrivateData: outputs.map((output) => output.privateData),
  outBlinding: outputs.map((output) => output.blinding),
  outEphemeralSecret: outputs.map((output) => output.ephemeralSecret),
  outNonce: outputs.map((output) => output.nonce),
  outEnvelope: outputs.map((output) => output.envelope),
  appendSiblings: tree.siblings,
};

writeFileSync(resolve(here, "withdraw.json"), `${decimalJson(fixture)}\n`);
