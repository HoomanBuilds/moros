import assert from "node:assert";
import { Keypair } from "@stellar/stellar-sdk";
import { sep53Hash, verifyWalletSignature } from "./verify.ts";

const kp = Keypair.random();
const address = kp.publicKey();
const message = "Sign in to Moros social - 2026-07-03T00:00:00.000Z";

const sep53Sig = kp.sign(sep53Hash(message)).toString("base64");
assert.equal(verifyWalletSignature(address, message, sep53Sig), true);

const legacySig = kp.sign(Buffer.from(message, "utf8")).toString("base64");
assert.equal(verifyWalletSignature(address, message, legacySig), true);

assert.equal(verifyWalletSignature(address, "different message", sep53Sig), false);

const other = Keypair.random();
assert.equal(verifyWalletSignature(other.publicKey(), message, sep53Sig), false);

assert.equal(verifyWalletSignature(address, message, ""), false);
assert.equal(verifyWalletSignature("not-a-key", message, sep53Sig), false);

console.log("verify ok");
