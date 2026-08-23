import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { decryptRecoveryPhrase, encryptRecoveryPhrase, parseWalletRecord } from "./wallet-crypto";

Object.defineProperty(globalThis, "crypto", { value: webcrypto });
Object.defineProperty(globalThis, "btoa", { value: (input: string) => Buffer.from(input, "binary").toString("base64") });
Object.defineProperty(globalThis, "atob", { value: (input: string) => Buffer.from(input, "base64").toString("binary") });

const phrase = Array.from({ length: 24 }, (_, index) => `word${index}`).join(" ");
const password = "a strong local wallet password";
const record = await encryptRecoveryPhrase(phrase, password, 1_780_000_000_000);

assert.equal(await decryptRecoveryPhrase(record, password), phrase);
assert.equal(parseWalletRecord(JSON.stringify(record)).format, 1);
assert.equal(record.backupVerified, false);
assert.equal(JSON.stringify(record).includes("word0"), false);
assert.equal(JSON.stringify(record).includes(password), false);

await assert.rejects(() => decryptRecoveryPhrase(record, "the wrong wallet password"), /incorrect or recovery data is damaged/);
await assert.rejects(
  () => decryptRecoveryPhrase({ ...record, ciphertext: record.ciphertext.slice(0, -4) + "AAAA" }, password),
  /incorrect or recovery data is damaged/,
);
await assert.rejects(() => encryptRecoveryPhrase(phrase, "short"), /at least 12/);
assert.throws(() => parseWalletRecord(JSON.stringify({ ...record, plaintext: phrase })), /invalid wallet record/);
const restored = await encryptRecoveryPhrase(phrase, password, 1_780_000_000_000, true);
assert.equal(restored.backupVerified, true);

console.log("payment wallet encryption tests passed");
