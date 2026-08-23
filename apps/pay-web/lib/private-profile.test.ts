import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { initSync, recovery_phrase_from_entropy } from "@moros/payments-crypto-web";
import {
  decryptPrivateProfile,
  emptyPrivateProfile,
  encryptPrivateProfile,
  validatePrivateProfile,
  withContact,
  withPaymentRequest,
  withPaymentRequestStatus,
  withPaymentActivity,
  mergePrivateProfiles,
  withRecentRecipient,
  withoutContact,
} from "./private-profile";
import { testDeployment } from "./test-deployment";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });
initSync({
  module: readFileSync(new URL("../../../packages/payments-crypto-web/moros_payments_core_bg.wasm", import.meta.url)),
});

const deployment = testDeployment();
const phrase = recovery_phrase_from_entropy(new Uint8Array(32).fill(17));
const recipient = {
  paymentCode: `moros_pay_${"a".repeat(280)}`,
  recipientFingerprint: "1234-5678-90AB",
  label: "Coffee counter",
  updatedAt: 1_780_000_000_000,
};
const profile = withRecentRecipient(withContact(emptyPrivateProfile(), recipient), recipient);
const encrypted = await encryptPrivateProfile({ phrase, deployment, profile, generation: 1 });
assert.equal(encrypted.pages.length, 8);
assert.equal(encrypted.pages.every((page) => page.length === 4_221), true);
assert.deepEqual(await decryptPrivateProfile({ phrase, deployment, record: encrypted }), profile);

const changed = structuredClone(encrypted);
changed.pages[2][120] ^= 1;
await assert.rejects(() => decryptPrivateProfile({ phrase, deployment, record: changed }), /archive|profile/i);

const otherPhrase = recovery_phrase_from_entropy(new Uint8Array(32).fill(18));
await assert.rejects(() => decryptPrivateProfile({ phrase: otherPhrase, deployment, record: encrypted }), /archive/i);
assert.equal(withoutContact(profile, recipient.paymentCode).contacts.length, 0);
assert.throws(() => validatePrivateProfile({ ...profile, nextChildIndex: 0 }), /sequence/);
assert.throws(() => validatePrivateProfile({ ...profile, contacts: [recipient, recipient] }), /duplicates/);

const request = {
  requestId: "abc123_request",
  paymentLink: `https://pay.moros.fun/pay#${"x".repeat(300)}`,
  recipientFingerprint: "1234-5678-90AB",
  label: "Lunch",
  amountAtomic: "12500000",
  createdAt: 1_780_000_000,
  expiresAt: 1_780_003_600,
  updatedAt: 1_780_000_000_000,
  status: "active" as const,
};
const withRequest = withPaymentRequest(profile, request);
assert.equal(withRequest.paymentRequests.length, 1);
assert.equal(withPaymentRequestStatus(withRequest, request.requestId, "cancelled").paymentRequests[0].status, "cancelled");
assert.throws(() => withPaymentRequestStatus(withRequest, "missing", "cancelled"), /not found/);
assert.deepEqual(validatePrivateProfile({ ...profile, paymentRequests: undefined }).paymentRequests, []);

const activity = {
  transactionHash: "ab".repeat(32),
  kind: "send" as const,
  amountAtomic: "25000000",
  recipientFingerprint: recipient.recipientFingerprint,
  createdAt: 1_780_000_100_000,
};
const withActivity = withPaymentActivity(profile, activity);
assert.deepEqual(withActivity.paymentActivities, [activity]);
assert.equal(withPaymentActivity(withActivity, activity).paymentActivities.length, 1);
assert.deepEqual(validatePrivateProfile({ ...profile, paymentActivities: undefined }).paymentActivities, []);
assert.throws(() => withPaymentActivity(profile, { ...activity, amountAtomic: "0" }), /activity/);

const removed = withoutContact(profile, recipient.paymentCode, recipient.updatedAt + 1);
assert.equal(mergePrivateProfiles(profile, removed).contacts.length, 0);
const restored = withContact(removed, { ...recipient, updatedAt: recipient.updatedAt + 2 });
assert.equal(restored.contacts.length, 1);

let full = emptyPrivateProfile();
for (let index = 0; index < 20; index += 1) {
  full = withContact(full, {
    ...recipient,
    paymentCode: `moros_pay_${String(index).padStart(3, "0")}${"c".repeat(277)}`,
    recipientFingerprint: `CONTACT-${String(index).padStart(4, "0")}`,
    label: `Private contact ${index}`,
    updatedAt: recipient.updatedAt + index,
  });
}
for (let index = 0; index < 40; index += 1) {
  full = withoutContact(
    full,
    `moros_pay_${String(index).padStart(3, "0")}${"d".repeat(277)}`,
    recipient.updatedAt + 100 + index,
  );
}
const fullEncrypted = await encryptPrivateProfile({ phrase, deployment, profile: full, generation: 2 });
assert.deepEqual(await decryptPrivateProfile({ phrase, deployment, record: fullEncrypted }), full);

process.stdout.write("private profile tests passed\n");
