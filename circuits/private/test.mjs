import assert from "node:assert/strict";
import {
  ACTION_PUBLIC_SIGNALS,
  BATCH_PUBLIC_SIGNALS,
  CIRCUITS,
  EXIT_MATCH_PUBLIC_SIGNALS,
  encodeG1,
  encodeG2,
  keyPayloadJson,
  parseR1csInfo,
  proofBytes,
  schemaHash,
} from "./artifacts.mjs";

assert.equal(CIRCUITS.length, 15);
assert.deepEqual(
  CIRCUITS.map((circuit) => circuit.code),
  [...Array(15).keys()],
);
assert.equal(ACTION_PUBLIC_SIGNALS.length, 15);
assert.equal(EXIT_MATCH_PUBLIC_SIGNALS.length, 20);
assert.equal(BATCH_PUBLIC_SIGNALS.length, 45);
assert.equal(new Set(CIRCUITS.map(schemaHash)).size, CIRCUITS.length);

const g1 = encodeG1(["1", "2", "1"]);
assert.equal(g1.length, 64);
assert.equal(g1.subarray(31, 32).toString("hex"), "01");
assert.equal(g1.subarray(63, 64).toString("hex"), "02");

const g2 = encodeG2([
  ["3", "4"],
  ["5", "6"],
  ["1", "0"],
]);
assert.equal(g2.length, 128);
assert.deepEqual(
  [31, 63, 95, 127].map((index) => g2[index]),
  [4, 3, 6, 5],
);

const actionCircuit = CIRCUITS[0];
const point = ["1", "2", "1"];
const extensionPoint = [
  ["3", "4"],
  ["5", "6"],
  ["1", "0"],
];
const vkey = {
  protocol: "groth16",
  curve: "bn128",
  nPublic: actionCircuit.publicSignals.length,
  vk_alpha_1: point,
  vk_beta_2: extensionPoint,
  vk_gamma_2: extensionPoint,
  vk_delta_2: extensionPoint,
  IC: Array.from(
    { length: actionCircuit.publicSignals.length + 1 },
    () => point,
  ),
};
const key = keyPayloadJson(actionCircuit, vkey);
assert.deepEqual(key.circuit, { tag: "Deposit" });
assert.equal(key.schema_hash.length, 64);
assert.equal(key.verification_key.alpha.length, 128);
assert.equal(key.verification_key.beta.length, 256);
assert.equal(key.verification_key.ic.length, 16);

const proof = proofBytes({
  protocol: "groth16",
  curve: "bn128",
  pi_a: point,
  pi_b: extensionPoint,
  pi_c: point,
});
assert.equal(proof.length, 256);
assert.throws(() => encodeG1(["-1", "2"]));
assert.throws(() =>
  encodeG1([
    "21888242871839275222246405745257275088696311157297823662689037894645226208583",
    "2",
  ]),
);

assert.deepEqual(
  parseR1csInfo(
    "\u001b[32m# of Wires: 20\u001b[0m\n# of Constraints: 19\n# of Private Inputs: 3\n# of Public Inputs: 15\n# of Labels: 40\n# of Outputs: 0\n",
  ),
  {
    wires: 20,
    constraints: 19,
    privateInputs: 3,
    publicInputs: 15,
    labels: 40,
    outputs: 0,
  },
);

console.log("private artifact encoding and schema tests passed");
