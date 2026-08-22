import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  format_usdc_amount,
  initSync,
  parse_usdc_amount,
  payment_archive_from_entropy,
  payment_identity_from_entropy,
  recovery_phrase_from_entropy,
} from "./moros_payments_core.js";

initSync({
  module: readFileSync(new URL("./moros_payments_core_bg.wasm", import.meta.url)),
});

const entropy = Buffer.alloc(32, 7);
const vault = Buffer.alloc(32, 8);
const phrase = recovery_phrase_from_entropy(entropy);
assert.equal(phrase.split(" ").length, 24);
const identity = payment_identity_from_entropy(entropy, 1, vault, 0n);
assert.equal(identity.payment_code.startsWith("moros_pay_"), true);
assert.equal(identity.recipient_fingerprint.length > 8, true);
const archive = payment_archive_from_entropy(entropy, 1, vault);
assert.equal(archive.locator.length, 32);
assert.equal(archive.signing_public_key.length, 32);
assert.equal(parse_usdc_amount("12.3456789"), "123456789");
assert.equal(format_usdc_amount("123456789"), "12.3456789");
archive.free();
identity.free();

process.stdout.write("payment browser cryptography tests passed\n");
