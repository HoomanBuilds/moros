import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { initSync, recovery_phrase_from_entropy } from "@moros/payments-crypto-web";
import { derivePaymentIdentity } from "./payment-identity";
import {
  merkleNode,
  merkleTree,
  paymentCodeForIdentity,
  paymentIdentityFromCode,
  selectPaymentNotes,
  type PaymentNote,
} from "./payment-protocol";
import { testDeployment } from "./test-deployment";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
initSync({
  module: readFileSync(new URL("../../../packages/payments-crypto-web/moros_payments_core_bg.wasm", import.meta.url)),
});

function note(amount: bigint, leafIndex: number): PaymentNote {
  return {
    purpose: 1n,
    amount,
    spendSecret: BigInt(leafIndex + 1),
    viewingPublicKey: [1n, 2n],
    noteId: BigInt(leafIndex + 10),
    payloadHash: 0n,
    privateData: [0n, 0n],
    blinding: BigInt(leafIndex + 20),
    commitment: BigInt(leafIndex + 30),
    nullifier: BigInt(leafIndex + 40),
    leafIndex,
  };
}

const notes = [note(3n, 0), note(4n, 1), note(8n, 2), note(2n, 3)];
assert.deepEqual(selectPaymentNotes(notes, 7n).map((entry) => entry.amount), [3n, 4n]);
assert.deepEqual(selectPaymentNotes(notes, 8n).map((entry) => entry.amount), [8n]);
assert.throws(() => selectPaymentNotes(notes.slice(0, 3), 20n), /too many notes/);
assert.throws(() => selectPaymentNotes(notes, 0n), /positive/);

const commitments = notes.map((entry) => entry.commitment);
const tree = merkleTree(commitments, 3);
let root = commitments[1];
let position = 1;
for (const sibling of tree.path(1)) {
  root = position % 2 === 0 ? merkleNode(root, sibling) : merkleNode(sibling, root);
  position = Math.floor(position / 2);
}
assert.equal(root, tree.root);

const identity = await derivePaymentIdentity(
  recovery_phrase_from_entropy(new Uint8Array(32).fill(17)),
  testDeployment(),
);
assert.equal(
  await paymentCodeForIdentity(identity.paymentCode, paymentIdentityFromCode(identity.paymentCode)),
  identity.paymentCode,
);

console.log("payment protocol tests passed");
