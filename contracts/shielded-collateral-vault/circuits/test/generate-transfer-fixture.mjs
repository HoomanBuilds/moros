import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { poseidon2Hash } from "../../../../circuits/node_modules/@zkpassport/poseidon2/dist/esm/index.js";
import {
  appendSecondPair,
  decimalJson,
  firstPairMembershipPaths,
  noteDomain,
  noteNullifier,
  outputNote,
} from "./privacy-fixture-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const levels = 20;
const inputs = JSON.parse(readFileSync(resolve(here, "deposit_notes.json"), "utf8"), (_, value) =>
  typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value,
);
const spendSecrets = [201n, 211n];
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
  1n,
  301n,
  302n,
  0n,
  0n,
  0n,
  0n,
  0n,
  0n,
  0n,
  0n,
  1_100n,
  0n,
  ...Array(24).fill(0n),
];
const domain = noteDomain(contextFields);
if (inputs.some((note) => note.noteDomain !== domain)) {
  throw new Error("input notes use a different domain");
}
const outputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 350_000_000n,
    spendSecret: 401n,
    viewingSecret: 402n,
    noteId: 403n,
    blinding: 404n,
    ephemeralSecret: 405n,
    nonce: 406n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 1n,
    amount: 150_000_000n,
    spendSecret: 411n,
    viewingSecret: 412n,
    noteId: 413n,
    blinding: 414n,
    ephemeralSecret: 415n,
    nonce: 416n,
  }),
];
const inputCommitments = inputs.map((note) => note.commitment);
const inputPaths = firstPairMembershipPaths(inputCommitments, levels);
const tree = appendSecondPair(
  inputCommitments,
  outputs.map((output) => output.commitment),
  levels,
);
const fixture = {
  action: 1n,
  contextDigest: poseidon2Hash(contextFields),
  membershipRoot: tree.appendRoot,
  appendRoot: tree.appendRoot,
  newRoot: tree.newRoot,
  nullifierCount: 2n,
  nullifier0: noteNullifier(inputs[0], spendSecrets[0]),
  nullifier1: noteNullifier(inputs[1], spendSecrets[1]),
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
  inSpendSecret: spendSecrets,
  inViewingPublicKey: inputs.map((note) => note.viewingPublicKey),
  inNoteId: inputs.map((note) => note.noteId),
  inPayloadHash: inputs.map((note) => note.payloadHash),
  inPrivateData: inputs.map((note) => note.privateData),
  inBlinding: inputs.map((note) => note.blinding),
  inLeafIndex: [0n, 1n],
  inSiblings: inputPaths,
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

writeFileSync(resolve(here, "transfer.json"), `${decimalJson(fixture)}\n`);
writeFileSync(resolve(here, "transfer_notes.json"), `${decimalJson(outputs)}\n`);
