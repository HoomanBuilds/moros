import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { poseidon2Hash } from "../../../../circuits/node_modules/@zkpassport/poseidon2/dist/esm/index.js";
import {
  appendFirstPair,
  decimalJson,
  noteDomain,
  outputNote,
} from "./privacy-fixture-lib.mjs";

const levels = 20;
const amount = 500_000_000n;
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
  0n,
  109n,
  110n,
  1n,
  111n,
  112n,
  0n,
  amount,
  0n,
  0n,
  0n,
  1_000n,
  0n,
  ...Array(24).fill(0n),
];
if (contextFields.length !== 46) throw new Error("invalid context shape");
const domain = noteDomain(contextFields);
const outputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 1n,
    amount: 300_000_000n,
    spendSecret: 201n,
    viewingSecret: 202n,
    noteId: 203n,
    blinding: 204n,
    ephemeralSecret: 205n,
    nonce: 206n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 1n,
    amount: 200_000_000n,
    spendSecret: 211n,
    viewingSecret: 212n,
    noteId: 207n,
    blinding: 208n,
    ephemeralSecret: 209n,
    nonce: 210n,
  }),
];
const tree = appendFirstPair(
  outputs.map((output) => output.commitment),
  levels,
);
const fixture = {
  action: 0n,
  contextDigest: poseidon2Hash(contextFields),
  membershipRoot: tree.appendRoot,
  appendRoot: tree.appendRoot,
  newRoot: tree.newRoot,
  nullifierCount: 0n,
  nullifier0: 0n,
  nullifier1: 0n,
  outputCommitment0: outputs[0].commitment,
  outputCommitment1: outputs[1].commitment,
  outputEnvelopeHash0: outputs[0].envelopeHash,
  outputEnvelopeHash1: outputs[1].envelopeHash,
  firstLeafIndex: 0n,
  publicAmountSign: 0n,
  publicAmountMagnitude: amount,
  contextFields,
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

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, "deposit.json"), `${decimalJson(fixture)}\n`);
writeFileSync(resolve(here, "deposit_notes.json"), `${decimalJson(outputs)}\n`);
