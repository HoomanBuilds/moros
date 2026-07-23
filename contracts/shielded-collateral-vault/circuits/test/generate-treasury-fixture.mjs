import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendFirstPair,
  decimalJson,
  noteDomain,
  outputNote,
  poseidon2Hash,
  spendPublicKey,
  viewingPublicKey,
} from "./privacy-fixture-lib.mjs";

const LEVELS = 20;
const amount = 4_000_000n;
const baseContext = [1n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
const domain = noteDomain(baseContext);
const treasurySpendSecret = 111n;
const treasuryViewingSecret = 112n;
const treasurySpendPublicKey = spendPublicKey(treasurySpendSecret);
const treasuryViewingPublicKey = viewingPublicKey(treasuryViewingSecret);
const treasuryKey = poseidon2Hash([
  1015n,
  treasurySpendPublicKey,
  ...treasuryViewingPublicKey,
]);
const treasuryPayload = poseidon2Hash([1016n, treasuryKey]);
const high = treasuryKey >> 128n;
const low = treasuryKey & ((1n << 128n) - 1n);
const contextFields = [
  ...baseContext,
  10n,
  101n,
  102n,
  0n,
  0n,
  0n,
  0n,
  amount,
  0n,
  0n,
  0n,
  10_000n,
  5n,
  high,
  low,
  ...Array(22).fill(0n),
];
if (contextFields.length !== 46) throw new Error("invalid context shape");

const outputs = [
  outputNote({
    outputIndex: 0,
    noteDomain: domain,
    purpose: 8n,
    amount,
    spendSecret: treasurySpendSecret,
    viewingSecret: treasuryViewingSecret,
    noteId: 113n,
    payloadHash: treasuryPayload,
    blinding: 114n,
    ephemeralSecret: 115n,
    nonce: 116n,
  }),
  outputNote({
    outputIndex: 1,
    noteDomain: domain,
    purpose: 0n,
    amount: 0n,
    spendSecret: 121n,
    viewingSecret: 122n,
    noteId: 123n,
    blinding: 124n,
    ephemeralSecret: 125n,
    nonce: 126n,
  }),
];
const append = appendFirstPair(
  outputs.map((output) => output.commitment),
  LEVELS,
);
const fixture = {
  action: 10n,
  contextDigest: poseidon2Hash(contextFields),
  membershipRoot: append.appendRoot,
  appendRoot: append.appendRoot,
  newRoot: append.newRoot,
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

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, "treasury.json"), `${decimalJson(fixture)}\n`);
