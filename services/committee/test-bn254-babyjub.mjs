import assert from "node:assert/strict";
import {
  BASE8,
  IDENTITY,
  SUBORDER,
  add,
  aggregateCiphertexts,
  decryptSide,
  encryptSide,
  isPoint,
  multiply,
  negate,
  publicKey,
  reconstructSecret,
} from "./bn254-babyjub.mjs";

assert.equal(isPoint(BASE8), true);
assert.deepEqual(multiply(BASE8, SUBORDER), IDENTITY);

const secret = 12345n;
const key = publicKey(secret);
const encrypted = [
  encryptSide(key, 1, 101n),
  encryptSide(key, 0, 102n),
  encryptSide(key, 1, 103n),
];
assert.deepEqual(encrypted.map((ciphertext) => decryptSide(secret, ciphertext)), [1, 0, 1]);

const aggregate = aggregateCiphertexts(encrypted);
assert.deepEqual(
  add(aggregate.c2, negate(multiply(aggregate.c1, 8n * secret))),
  multiply(BASE8, 2n),
);

const slope = 777n;
const shares = [1n, 2n].map((index) => ({
  index,
  value: (secret + slope * index) % SUBORDER,
}));
assert.equal(reconstructSecret(shares), secret);

console.log("BN254 Baby Jubjub committee primitives passed");
