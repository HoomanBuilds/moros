import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  depositFixture,
  stringifyFixture,
  transferFixture,
  withdrawFixture,
} from "./fixture-lib.mjs";
import { PAYMENT_PUBLIC_SIGNALS } from "./artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const sourceRoot = resolve(repo, "contracts/payment-circuits");
const nodeModules = resolve(repo, "circuits/node_modules");
const snarkjs = resolve(nodeModules, "snarkjs/build/cli.cjs");
const build = mkdtempSync(join(tmpdir(), "moros-payment-circuits."));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}

function compile(name) {
  run("circom", [
    resolve(sourceRoot, `${name}.circom`),
    "--wasm",
    "--r1cs",
    "-l",
    nodeModules,
    "-o",
    build,
  ]);
}

function witness(name, fixture, suffix = "valid") {
  const input = resolve(build, `${name}-${suffix}.json`);
  const output = resolve(build, `${name}-${suffix}.wtns`);
  writeFileSync(input, `${stringifyFixture(fixture)}\n`);
  const result = spawnSync(
    "node",
    [
      resolve(build, `${name}_js/generate_witness.js`),
      resolve(build, `${name}_js/${name}.wasm`),
      input,
      output,
    ],
    { cwd: repo, encoding: "utf8" },
  );
  return { result, output };
}

function valid(name, fixture) {
  const { result, output } = witness(name, fixture);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${name} rejected its valid fixture`);
  }
  run("node", [snarkjs, "wtns", "check", resolve(build, `${name}.r1cs`), output]);
  const exported = resolve(build, `${name}-public.json`);
  run("node", [snarkjs, "wtns", "export", "json", output, exported]);
  const values = JSON.parse(readFileSync(exported, "utf8")).slice(
    1,
    PAYMENT_PUBLIC_SIGNALS.length + 1,
  );
  const expected = PAYMENT_PUBLIC_SIGNALS.map((signal) => fixture[signal].toString());
  if (JSON.stringify(values) !== JSON.stringify(expected)) {
    throw new Error(`${name} public signal ordering mismatch`);
  }
}

function invalid(name, fixture, label, mutate) {
  const changed = structuredClone(fixture);
  mutate(changed);
  const { result } = witness(name, changed, label);
  if (result.status === 0) {
    throw new Error(`${name} accepted invalid ${label} fixture`);
  }
}

const fixtures = new Map([
  ["deposit", depositFixture()],
  ["transfer_one", transferFixture(1)],
  ["transfer_two", transferFixture(2)],
  ["transfer_four", transferFixture(4)],
  ["withdraw_one", withdrawFixture(1)],
  ["withdraw_two", withdrawFixture(2)],
  ["withdraw_four", withdrawFixture(4)],
]);

try {
  for (const [name, fixture] of fixtures) {
    compile(name);
    valid(name, fixture);
  }

  invalid("deposit", fixtures.get("deposit"), "public-amount", (fixture) => {
    fixture.publicAmountMagnitude += 1n;
  });
  invalid("transfer_one", fixtures.get("transfer_one"), "value-creation", (fixture) => {
    fixture.outAmount[1] += 1n;
  });
  invalid("transfer_two", fixtures.get("transfer_two"), "relay-recipient", (fixture) => {
    fixture.outSpendPublicKey[2] += 1n;
  });
  invalid("transfer_four", fixtures.get("transfer_four"), "attachment", (fixture) => {
    fixture.attachmentFields[0] += 1n;
  });
  invalid("withdraw_one", fixtures.get("withdraw_one"), "public-amount", (fixture) => {
    fixture.publicAmountMagnitude += 1n;
  });
  invalid("withdraw_two", fixtures.get("withdraw_two"), "protocol-fee", (fixture) => {
    fixture.outAmount[2] += 1n;
  });
  const emergency = withdrawFixture(4, true);
  valid("withdraw_four", emergency);
  invalid("withdraw_four", emergency, "emergency-output", (fixture) => {
    fixture.outAmount[0] = 1n;
  });

  console.log("private payment circuit witnesses passed");
} finally {
  rmSync(build, { recursive: true, force: true });
}
