import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  canonicalJson,
  keyPayloadJson,
  parseR1csInfo,
  sha256,
  sha256File,
} from "../private/artifacts.mjs";
import { PAYMENT_CIRCUITS, PAYMENT_PUBLIC_SIGNALS } from "./artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const sourceRoot = resolve(repo, "contracts/payment-circuits");
const nodeModules = resolve(repo, "circuits/node_modules");
const snarkjs = resolve(nodeModules, "snarkjs/build/cli.cjs");
const outputRoot = resolve(
  process.env.MOROS_PAYMENT_ZK_BUILD_DIR || resolve(repo, "circuits/payments-build"),
);
const command = process.argv[2] || "compile";
const maximumPtauPower = 18;
const trustedPtauBlake2b =
  "7e6a9c2e5f05179ddfc923f38f917c9e6831d16922a902b0b4758b8e79c2ab8a81bb5f29952e16ee6c5067ed044d7857b5de120a90704c1d3b637fd94b95b13e";

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${program} failed`);
  }
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function cleanOutput() {
  const output = relative(repo, outputRoot);
  if (output.startsWith("..") || !output.startsWith("circuits/payments-build")) {
    throw new Error("MOROS_PAYMENT_ZK_BUILD_DIR must remain under circuits/payments-build");
  }
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
}

function sourceBundleHash() {
  const files = readdirSync(sourceRoot)
    .filter((name) => name.endsWith(".circom"))
    .sort();
  return sha256(
    canonicalJson(files.map((name) => [name, readFileSync(resolve(sourceRoot, name), "utf8")])),
  );
}

function circuitSchema(circuit) {
  return {
    circuit: circuit.name,
    circuitCode: circuit.code,
    curve: "bn254",
    proofSystem: "groth16",
    publicSignals: PAYMENT_PUBLIC_SIGNALS,
  };
}

function circuitSchemaHash(circuit) {
  return sha256(canonicalJson(circuitSchema(circuit)));
}

function circuitPaths(circuit) {
  const directory = resolve(outputRoot, circuit.name);
  return {
    directory,
    r1cs: resolve(directory, `${circuit.name}.r1cs`),
    wasm: resolve(directory, `${circuit.name}_js/${circuit.name}.wasm`),
    initialZkey: resolve(directory, `${circuit.name}_initial.zkey`),
    contributedZkey: resolve(directory, `${circuit.name}_contributed.zkey`),
    zkey: resolve(directory, `${circuit.name}.zkey`),
    vkey: resolve(directory, `${circuit.name}.vk.json`),
    key: resolve(directory, `${circuit.name}.key.json`),
  };
}

async function hashFile(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function compileAll() {
  cleanOutput();
  const records = [];
  for (const circuit of PAYMENT_CIRCUITS) {
    const paths = circuitPaths(circuit);
    mkdirSync(paths.directory, { recursive: true });
    run("circom", [
      resolve(sourceRoot, `${circuit.name}.circom`),
      "--wasm",
      "--r1cs",
      "--sym",
      "-l",
      nodeModules,
      "-o",
      paths.directory,
    ]);
    const info = parseR1csInfo(run("node", [snarkjs, "r1cs", "info", paths.r1cs]));
    if (info.publicInputs !== PAYMENT_PUBLIC_SIGNALS.length || info.outputs !== 0) {
      throw new Error(`${circuit.name} public-signal schema mismatch`);
    }
    records.push({
      name: circuit.name,
      code: circuit.code,
      action: circuit.action,
      input_count: circuit.inputCount,
      output_count: circuit.outputCount,
      public_inputs: info.publicInputs,
      constraints: info.constraints,
      wires: info.wires,
      required_ptau_power: Math.ceil(Math.log2(info.wires)),
      r1cs_sha256: sha256File(paths.r1cs),
      wasm_sha256: sha256File(paths.wasm),
      schema_sha256: circuitSchemaHash(circuit),
    });
    process.stdout.write(`compiled ${circuit.name}\n`);
  }
  const requiredPower = Math.max(...records.map((record) => record.required_ptau_power));
  if (requiredPower > maximumPtauPower) {
    throw new Error(`payment circuits require Powers of Tau power ${requiredPower}`);
  }
  writeFileSync(
    resolve(outputRoot, "compile-manifest.json"),
    `${JSON.stringify({
      curve: "bn254",
      proof_system: "groth16",
      required_ptau_power: requiredPower,
      maximum_ptau_power: maximumPtauPower,
      circuits: records,
    }, null, 2)}\n`,
  );
}

function assertCompiled() {
  for (const circuit of PAYMENT_CIRCUITS) {
    const paths = circuitPaths(circuit);
    if (!existsSync(paths.r1cs) || !existsSync(paths.wasm)) {
      throw new Error(`missing compiled artifacts for ${circuit.name}`);
    }
  }
}

async function setupAll() {
  if ((process.env.MOROS_NETWORK || "testnet") !== "testnet") {
    throw new Error("the payment setup pipeline is testnet only");
  }
  const ptau = process.env.MOROS_PTAU;
  if (!ptau || !existsSync(ptau) || !statSync(ptau).isFile()) {
    throw new Error("MOROS_PTAU must point to a BN254 phase-2 ptau file");
  }
  assertCompiled();
  const compileManifest = JSON.parse(
    readFileSync(resolve(outputRoot, "compile-manifest.json"), "utf8"),
  );
  const ptauBlake2b = await hashFile(ptau, "blake2b512");
  if (ptauBlake2b !== trustedPtauBlake2b && process.env.MOROS_ALLOW_CUSTOM_PTAU !== "1") {
    throw new Error("Powers of Tau hash is not the reviewed power 18 transcript");
  }
  if (ptauBlake2b !== trustedPtauBlake2b || process.env.MOROS_PAYMENT_VERIFY_PTAU === "1") {
    run("node", [snarkjs, "powersoftau", "verify", ptau]);
  }
  const ptauSha256 = await hashFile(ptau, "sha256");
  const setupLabel =
    process.env.MOROS_PAYMENT_SETUP_LABEL || "moros-payments-testnet-development";
  const entries = [];
  for (const circuit of PAYMENT_CIRCUITS) {
    const paths = circuitPaths(circuit);
    const beacon = randomBytes(32).toString("hex");
    run("node", [snarkjs, "groth16", "setup", paths.r1cs, ptau, paths.initialZkey]);
    run("node", [
      snarkjs,
      "zkey",
      "contribute",
      paths.initialZkey,
      paths.contributedZkey,
      `--name=${setupLabel}`,
      `--entropy=${randomBytes(64).toString("hex")}`,
    ]);
    run("node", [
      snarkjs,
      "zkey",
      "beacon",
      paths.contributedZkey,
      paths.zkey,
      beacon,
      "10",
      `--name=${setupLabel}-beacon`,
    ]);
    run("node", [snarkjs, "zkey", "verify", paths.r1cs, ptau, paths.zkey]);
    run("node", [snarkjs, "zkey", "export", "verificationkey", paths.zkey, paths.vkey]);
    const vkey = JSON.parse(readFileSync(paths.vkey, "utf8"));
    const key = keyPayloadJson(circuit, vkey);
    if (key.schema_hash !== circuitSchemaHash(circuit)) {
      throw new Error(`${circuit.name} contract key schema mismatch`);
    }
    writeFileSync(paths.key, `${JSON.stringify(key, null, 2)}\n`);
    const compiled = compileManifest.circuits.find((entry) => entry.name === circuit.name);
    entries.push({
      ...compiled,
      source: relative(repo, resolve(sourceRoot, `${circuit.name}.circom`)),
      source_sha256: sha256File(resolve(sourceRoot, `${circuit.name}.circom`)),
      schema: circuitSchema(circuit),
      proving_key_sha256: sha256File(paths.zkey),
      verification_key_sha256: sha256File(paths.vkey),
      contract_key_sha256: sha256File(paths.key),
      phase2_beacon: beacon,
      artifacts: {
        wasm: `${circuit.name}/${circuit.name}_js/${circuit.name}.wasm`,
        proving_key: `${circuit.name}/${circuit.name}.zkey`,
        verification_key: `${circuit.name}/${circuit.name}.vk.json`,
        contract_key: `${circuit.name}/${circuit.name}.key.json`,
      },
    });
    rmSync(paths.initialZkey, { force: true });
    rmSync(paths.contributedZkey, { force: true });
    process.stdout.write(`prepared ${circuit.name}\n`);
  }
  writeFileSync(
    resolve(outputRoot, "manifest.json"),
    `${JSON.stringify({
      format: 1,
      environment: "testnet",
      network: "stellar:testnet",
      mainnet_ready: false,
      setup_label: setupLabel,
      curve: "bn254",
      proof_system: "groth16",
      proof_encoding: "A(X,Y)||B(X.c1,X.c0,Y.c1,Y.c0)||C(X,Y)",
      required_ptau_power: compileManifest.required_ptau_power,
      ptau_sha256: ptauSha256,
      ptau_blake2b: ptauBlake2b,
      source_bundle_sha256: sourceBundleHash(),
      circuits: entries,
    }, null, 2)}\n`,
  );
}

function packageArtifacts() {
  const manifestPath = resolve(outputRoot, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("run setup before packaging artifacts");
  const publicRoot = resolve(outputRoot, "public");
  rmSync(publicRoot, { recursive: true, force: true });
  mkdirSync(publicRoot, { recursive: true });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const circuit of PAYMENT_CIRCUITS) {
    const paths = circuitPaths(circuit);
    cpSync(paths.wasm, resolve(publicRoot, `${circuit.name}.wasm`));
    cpSync(paths.zkey, resolve(publicRoot, `${circuit.name}.zkey`));
    cpSync(paths.vkey, resolve(publicRoot, `${circuit.name}.vk.json`));
  }
  manifest.circuits = manifest.circuits.map((entry) => ({
    ...entry,
    wasm_url: `/zk/payments/${entry.name}.wasm`,
    proving_key_url: `/zk/payments/${entry.name}.zkey`,
    artifacts: {
      wasm: `${entry.name}.wasm`,
      proving_key: `${entry.name}.zkey`,
      verification_key: `${entry.name}.vk.json`,
    },
  }));
  writeFileSync(resolve(publicRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function refreshContractKeys() {
  const manifestPath = resolve(outputRoot, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("run setup before refreshing contract keys");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const circuit of PAYMENT_CIRCUITS) {
    const paths = circuitPaths(circuit);
    const vkey = JSON.parse(readFileSync(paths.vkey, "utf8"));
    writeFileSync(paths.key, `${JSON.stringify(keyPayloadJson(circuit, vkey), null, 2)}\n`);
    const entry = manifest.circuits.find((candidate) => candidate.name === circuit.name);
    if (!entry) throw new Error(`manifest is missing ${circuit.name}`);
    entry.contract_key_sha256 = sha256File(paths.key);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (!["compile", "setup", "keys", "package", "all"].includes(command)) {
  throw new Error("usage: node payments/build.mjs compile|setup|keys|package|all");
}
if (command === "compile" || command === "all") compileAll();
if (command === "setup" || command === "all") await setupAll();
if (command === "keys") refreshContractKeys();
if (command === "package" || command === "all") packageArtifacts();
