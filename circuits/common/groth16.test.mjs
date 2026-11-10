import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson, schemaHash, scalarBytes, proofBytes, parseR1csInfo } from "./groth16.mjs";
import { PAYMENT_CIRCUITS } from "../payments/artifacts.mjs";
const deployment = JSON.parse(readFileSync(new URL("../../deployments/payments-mainnet.json", import.meta.url)));
for (const circuit of PAYMENT_CIRCUITS) {
  assert.equal(schemaHash(circuit), deployment.circuits.find(({ name }) => name === circuit.name).schemaHash);
}
assert.equal(canonicalJson({ z: 1, a: [2, 3] }), '{"a":[2,3],"z":1}');
assert.equal(scalarBytes(1n).length, 32);
assert.throws(() => scalarBytes(-1n));
assert.throws(() => scalarBytes(1n << 256n));
assert.throws(() => proofBytes({ protocol: "unknown", curve: "bn128" }));
assert.throws(() => parseR1csInfo("missing fields"));
console.log("Groth16 serialization and deployed payment schemas verified");
