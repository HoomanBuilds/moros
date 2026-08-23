import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { initSync, parse_usdc_amount, recovery_phrase_from_entropy } from "@moros/payments-crypto-web";
import { createIncomingViewingExport, createPaymentRequest, derivePaymentIdentity, verifyDirectPaymentCode, verifyPaymentRequest } from "./payment-identity";
import { testDeployment } from "./test-deployment";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });
initSync({
  module: readFileSync(new URL("../../../packages/payments-crypto-web/moros_payments_core_bg.wasm", import.meta.url)),
});

const deployment = testDeployment();
const phrase = recovery_phrase_from_entropy(new Uint8Array(32).fill(9));
const identity = await derivePaymentIdentity(phrase, deployment);
assert.match(identity.paymentCode, /^moros_pay_/);
assert.match(identity.recipientFingerprint, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
assert.deepEqual(await verifyDirectPaymentCode(identity.paymentCode, deployment), identity);
await assert.rejects(() => verifyDirectPaymentCode(`moros_pay_${"a".repeat(400)}`, deployment), /not a Moros/);

const nextIdentity = await derivePaymentIdentity(phrase, deployment, 1n);
assert.notEqual(nextIdentity.paymentCode, identity.paymentCode);
const incomingExport = await createIncomingViewingExport(phrase, deployment, 1);
const incomingView = (await import("@moros/payments-crypto-web")).decode_incoming_viewing_export(incomingExport);
assert.equal(incomingView.maximum_child_index, 1n);
assert.equal(incomingView.payment_code(1), nextIdentity.paymentCode);
incomingView.free();

const link = await createPaymentRequest({
  phrase,
  deployment,
  childIndex: 1n,
  amountAtomic: parse_usdc_amount("12.50"),
  merchantLabel: "Moros Store",
  now: 1_780_000_000,
  expiresAt: 1_780_003_600,
});
assert.match(link, /^https:\/\/pay\.moros\.fun\/pay#/);

const verified = await verifyPaymentRequest(link, deployment, 1_780_000_001);
assert.equal(verified.amountAtomic, "125000000");
assert.match(verified.requestId, /^[A-Za-z0-9_-]{22}$/);
assert.equal(verified.createdAt, 1_780_000_000);
assert.equal(verified.merchantLabel, "Moros Store");
assert.equal(verified.recipientFingerprint, nextIdentity.recipientFingerprint);

await assert.rejects(
  () => verifyDirectPaymentCode(identity.paymentCode, { ...deployment, network: "stellar:pubnet" }),
  /another Stellar network/,
);

await assert.rejects(() => verifyPaymentRequest(link, deployment, 1_780_003_600), /expired/);
const replacement = link.endsWith("A") ? "B" : "A";
await assert.rejects(
  () => verifyPaymentRequest(`${link.slice(0, -1)}${replacement}`, deployment, 1_780_000_001),
  /invalid|signature|encoding/,
);

console.log("payment link tests passed");
