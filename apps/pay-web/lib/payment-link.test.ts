import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { initSync, parse_usdc_amount, recovery_phrase_from_entropy } from "@moros/payments-crypto-web";
import { createPaymentRequest, derivePaymentIdentity, verifyPaymentRequest } from "./payment-identity";
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

const link = await createPaymentRequest({
  phrase,
  deployment,
  amountAtomic: parse_usdc_amount("12.50"),
  merchantLabel: "Moros Store",
  now: 1_780_000_000,
  expiresAt: 1_780_003_600,
});
assert.match(link, /^https:\/\/pay\.moros\.fun\/pay#/);

const verified = await verifyPaymentRequest(link, deployment, 1_780_000_001);
assert.equal(verified.amountAtomic, "125000000");
assert.equal(verified.merchantLabel, "Moros Store");
assert.equal(verified.recipientFingerprint, identity.recipientFingerprint);

await assert.rejects(() => verifyPaymentRequest(link, deployment, 1_780_003_600), /expired/);
const replacement = link.endsWith("A") ? "B" : "A";
await assert.rejects(
  () => verifyPaymentRequest(`${link.slice(0, -1)}${replacement}`, deployment, 1_780_000_001),
  /invalid|signature|encoding/,
);

console.log("payment link tests passed");
