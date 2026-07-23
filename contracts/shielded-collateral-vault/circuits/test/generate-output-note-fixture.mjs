import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decimalJson,
  outputNote,
} from "./privacy-fixture-lib.mjs";

const noteDomain = 31n;
const purpose = 1n;
const amount = 100_000_000n;
const spendSecret = 29n;
const viewingSecret = 17n;
const noteId = 37n;
const payloadHash = 0n;
const privateData = [0n, 0n];
const blinding = 41n;
const ephemeralSecret = 19n;
const nonce = 23n;
const output = outputNote({
  outputIndex: 0,
  noteDomain,
  purpose,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  payloadHash,
  privateData,
  blinding,
  ephemeralSecret,
  nonce,
});

const fixture = {
  noteDomain: output.noteDomain,
  purpose: output.purpose,
  amount: output.amount,
  spendPublicKey: output.spendPublicKey,
  viewingPublicKey: output.viewingPublicKey,
  noteId: output.noteId,
  payloadHash: output.payloadHash,
  privateData: output.privateData,
  blinding: output.blinding,
  ephemeralSecret: output.ephemeralSecret,
  nonce: output.nonce,
  envelope: output.envelope,
};

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, "output_note.json"), `${decimalJson(fixture)}\n`);
writeFileSync(
  resolve(here, "output_note_expected.json"),
  `${decimalJson({
    commitment: output.commitment,
    envelopeHash: output.envelopeHash,
  })}\n`,
);
