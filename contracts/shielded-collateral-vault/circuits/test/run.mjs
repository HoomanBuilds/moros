import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const circuitRoot = resolve(here, "..");
const nodeModules = resolve(repo, "circuits/node_modules");
const snarkjs = resolve(nodeModules, "snarkjs/build/cli.cjs");
const build = mkdtempSync(join(tmpdir(), "moros-private-circuits."));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}

function generate(name) {
  run("node", [resolve(here, `generate-${name}-fixture.mjs`)]);
}

function compile(name, source = resolve(circuitRoot, `${name}.circom`)) {
  run("circom", [
    source,
    "--wasm",
    "--r1cs",
    "-l",
    nodeModules,
    "-o",
    build,
  ]);
}

function witness(name, fixture, destination) {
  return spawnSync(
    "node",
    [
      resolve(build, `${name}_js/generate_witness.js`),
      resolve(build, `${name}_js/${name}.wasm`),
      fixture,
      destination,
    ],
    { cwd: repo, encoding: "utf8" },
  );
}

function validWitness(name) {
  const output = resolve(build, `${name}.wtns`);
  const result = witness(name, resolve(here, `${name}.json`), output);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${name} witness generation failed`);
  }
  run("node", [snarkjs, "wtns", "check", resolve(build, `${name}.r1cs`), output]);
}

function expectInvalid(name, label, mutate) {
  const fixture = JSON.parse(readFileSync(resolve(here, `${name}.json`), "utf8"));
  mutate(fixture);
  const input = resolve(build, `${name}-${label}.json`);
  const output = resolve(build, `${name}-${label}.wtns`);
  writeFileSync(input, `${JSON.stringify(fixture)}\n`);
  const result = witness(name, input, output);
  if (result.status === 0) {
    throw new Error(`${name} accepted invalid ${label} fixture`);
  }
}

generate("output-note");
generate("deposit");
generate("transfer");
generate("withdraw");
generate("order");
run("node", [resolve(here, "generate-liquidity-fixtures.mjs")]);

compile("output_note", resolve(here, "output_note.circom"));
validWitness("output_note");
run("node", [
  snarkjs,
  "wtns",
  "export",
  "json",
  resolve(build, "output_note.wtns"),
  resolve(build, "output_note.witness.json"),
]);
const outputWitness = JSON.parse(
  readFileSync(resolve(build, "output_note.witness.json"), "utf8"),
);
const expectedOutput = JSON.parse(
  readFileSync(resolve(here, "output_note_expected.json"), "utf8"),
);
if (
  outputWitness[1] !== expectedOutput.commitment ||
  outputWitness[2] !== expectedOutput.envelopeHash
) {
  throw new Error("output note does not match the TypeScript fixture");
}

for (const name of ["deposit", "transfer", "withdraw"]) {
  compile(name);
  validWitness(name);
}
compile("order");
validWitness("order");
for (const name of ["liquidity_fund", "liquidity_exit", "liquidity_redeem"]) {
  compile(name);
  validWitness(name);
}

expectInvalid("transfer", "value-creation", (fixture) => {
  fixture.outAmount[0] = (BigInt(fixture.outAmount[0]) + 1n).toString();
});
expectInvalid("transfer", "recovery-envelope", (fixture) => {
  fixture.outEnvelope[0][4] = (BigInt(fixture.outEnvelope[0][4]) + 1n).toString();
});
expectInvalid("withdraw", "public-amount", (fixture) => {
  fixture.publicAmountMagnitude = (
    BigInt(fixture.publicAmountMagnitude) + 1n
  ).toString();
});
expectInvalid("deposit", "operation-context", (fixture) => {
  fixture.contextFields[16] = (
    BigInt(fixture.contextFields[16]) + 1n
  ).toString();
});
expectInvalid("order", "hidden-side-ciphertext", (fixture) => {
  fixture.side = fixture.side === "1" ? "0" : "1";
});
expectInvalid("order", "accepted-root-append", (fixture) => {
  fixture.acceptedSiblings[0] = (
    BigInt(fixture.acceptedSiblings[0]) + 1n
  ).toString();
});
expectInvalid("order", "position-budget", (fixture) => {
  fixture.outAmount[1] = (BigInt(fixture.outAmount[1]) + 1n).toString();
});
expectInvalid("order", "encryption-randomness", (fixture) => {
  fixture.encryptionRandomness = (
    BigInt(fixture.encryptionRandomness) + 1n
  ).toString();
});
expectInvalid("liquidity_fund", "share-amount", (fixture) => {
  fixture.outAmount[1] = (BigInt(fixture.outAmount[1]) + 1n).toString();
});
expectInvalid("liquidity_fund", "funding-conservation", (fixture) => {
  fixture.outAmount[0] = (BigInt(fixture.outAmount[0]) + 1n).toString();
});
expectInvalid("liquidity_exit", "wrong-market-payload", (fixture) => {
  fixture.inPayloadHash[0] = (
    BigInt(fixture.inPayloadHash[0]) + 1n
  ).toString();
});
expectInvalid("liquidity_exit", "share-conservation", (fixture) => {
  fixture.outAmount[1] = (BigInt(fixture.outAmount[1]) + 1n).toString();
});
expectInvalid("liquidity_redeem", "terminal-remainder", (fixture) => {
  fixture.outAmount[1] = "1";
});

console.log("private balance, order, and liquidity circuit fixtures passed");
