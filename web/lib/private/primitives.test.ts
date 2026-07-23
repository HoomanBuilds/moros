import assert from "node:assert/strict";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import depositFixture from "../../../contracts/shielded-collateral-vault/circuits/test/deposit.json";
import depositNotes from "../../../contracts/shielded-collateral-vault/circuits/test/deposit_notes.json";
import {
  appendFour,
  appendPair,
  appendOne,
  createOutputNote,
  createOutputNoteForRecipient,
  decryptAllocationWitness,
  decryptOutputNote,
  envelopeToFields,
  fieldsToEnvelope,
  merkleTree,
  modField,
  multiplyPoint,
  noteDomain,
  spendPublicKey,
  viewingPublicKey,
} from "./primitives.ts";

function decimals(value: unknown): bigint[] {
  if (!Array.isArray(value)) throw new Error("Expected an array");
  return value.map((field) => BigInt(String(field)));
}

const fixture = depositFixture as Record<string, unknown>;
const notes = depositNotes as Array<Record<string, unknown>>;
const contextFields = decimals(fixture.contextFields);
const domain = noteDomain(contextFields);
const first = notes[0];
const recreated = createOutputNote({
  outputIndex: 0,
  domain,
  purpose: BigInt(String(first.purpose)),
  amount: BigInt(String(first.amount)),
  spendSecret: 201n,
  viewingSecret: 202n,
  noteId: BigInt(String(first.noteId)),
  payloadHash: BigInt(String(first.payloadHash)),
  privateData: decimals(first.privateData) as [bigint, bigint],
  blinding: BigInt(String(first.blinding)),
  ephemeralSecret: BigInt(String(first.ephemeralSecret)),
  nonce: BigInt(String(first.nonce)),
});

assert.equal(recreated.commitment, BigInt(String(first.commitment)));
assert.equal(recreated.envelopeHash, BigInt(String(first.envelopeHash)));
const recipientOutput = createOutputNoteForRecipient({
  outputIndex: 0,
  domain,
  purpose: recreated.purpose,
  amount: recreated.amount,
  spendPublicKey: recreated.spendPublicKey,
  viewingPublicKey: recreated.viewingPublicKey,
  noteId: recreated.noteId,
  payloadHash: recreated.payloadHash,
  privateData: recreated.privateData,
  blinding: recreated.blinding,
  ephemeralSecret: recreated.ephemeralSecret,
  nonce: recreated.nonce,
});
assert.deepEqual(recipientOutput, recreated);

const envelopeBytes = fieldsToEnvelope(recreated.envelope);
assert.deepEqual(envelopeToFields(envelopeBytes), recreated.envelope);
const decrypted = decryptOutputNote(
  recreated.envelope,
  202n,
  domain,
  recreated.commitment,
  spendPublicKey(201n),
);
assert.equal(decrypted?.amount, recreated.amount);
assert.equal(decrypted?.noteId, recreated.noteId);
assert.equal(decryptOutputNote(recreated.envelope, 999n, domain), null);

const commitments = notes.map((note) => BigInt(String(note.commitment)));
const empty = merkleTree([], 20);
const appended = appendPair(empty, commitments as [bigint, bigint]);
assert.equal(appended.appendRoot, BigInt(String(fixture.appendRoot)));
assert.equal(appended.newRoot, BigInt(String(fixture.newRoot)));
assert.deepEqual(appended.siblings, decimals(fixture.appendSiblings));

const one = appendOne(empty, commitments[0]);
const singleTree = merkleTree([commitments[0]], 20);
assert.equal(one.appendRoot, empty.root);
assert.equal(one.newRoot, singleTree.root);
const fourCommitments = [11n, 12n, 13n, 14n] as const;
const appendedFour = appendFour(
  empty,
  [...fourCommitments] as [bigint, bigint, bigint, bigint],
);
assert.equal(
  appendedFour.middleRoot,
  merkleTree(fourCommitments.slice(0, 2), 20).root,
);
assert.equal(
  appendedFour.newRoot,
  merkleTree([...fourCommitments], 20).root,
);
assert.equal(appendedFour.firstLeafIndex, 0);

const allocationShared = multiplyPoint(viewingPublicKey(19n), 8n * 101n);
const allocationPlaintext = [
  1n,
  2n,
  3n,
  4n,
  20n,
  1_000n,
  1n,
  5_000_000n,
  100_000n,
  10_000_000n,
  0n,
  11n,
  12n,
  13n,
  14n,
  15n,
  16n,
];
const allocationNonce = 999n;
const allocationCiphertext = allocationPlaintext.map((value, index) =>
  modField(value + poseidon2Hash([
    1014n,
    allocationShared[0],
    allocationShared[1],
    allocationNonce,
    BigInt(index),
  ]))
);
const allocationEnvelope = [
  1n,
  allocationNonce,
  ...allocationCiphertext,
  poseidon2Hash([
    1015n,
    allocationShared[0],
    allocationShared[1],
    allocationNonce,
    ...allocationPlaintext,
  ]),
];
const allocation = decryptAllocationWitness(
  allocationEnvelope,
  allocationShared,
);
assert.equal(allocation.positionCommitment, 1_000n);
assert.equal(allocation.side, 1n);
assert.equal(allocation.charge, 5_000_000n);
assert.deepEqual(allocation.siblings, [11n, 12n, 13n, 14n, 15n, 16n]);
assert.throws(
  () => decryptAllocationWitness(allocationEnvelope, viewingPublicKey(20n)),
  /authentication/,
);

console.log("private note primitives ok");
