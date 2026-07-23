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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CIRCUITS,
  keyPayloadJson,
  parseR1csInfo,
  schema,
  schemaHash,
  sha256,
  sha256File,
} from "./artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const sourceRoot = resolve(repo, "contracts/shielded-collateral-vault/circuits");
const nodeModules = resolve(repo, "circuits/node_modules");
const snarkjs = resolve(nodeModules, "snarkjs/build/cli.cjs");
const outputRoot = resolve(
  process.env.MOROS_ZK_BUILD_DIR || resolve(repo, "circuits/private-build"),
);
const command = process.argv[2] || "compile";
const requiredPower = 18;
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
  const relativeOutput = relative(repo, outputRoot);
  if (
    relativeOutput.startsWith("..") ||
    !relativeOutput.startsWith("circuits/private-build")
  ) {
    throw new Error("MOROS_ZK_BUILD_DIR must remain under circuits/private-build");
  }
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
}

function sourceBundleHash() {
  const files = readdirSync(sourceRoot)
    .filter((name) => name.endsWith(".circom"))
    .sort();
  const hashInput = files.map((name) => [
    name,
    readFileSync(resolve(sourceRoot, name), "utf8"),
  ]);
  return sha256(JSON.stringify(hashInput));
}

function toolVersion(program, args) {
  return run(program, args).trim();
}

function gitCommit() {
  return run("git", ["rev-parse", "HEAD"]).trim();
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

function assertCircuitSourcesCommitted() {
  const status = run("git", [
    "status",
    "--porcelain",
    "--",
    relative(repo, sourceRoot),
    "contracts/privacy-types/src/lib.rs",
    "contracts/zk-verifier/src/lib.rs",
  ]);
  if (status.trim() && process.env.MOROS_ALLOW_DIRTY !== "1") {
    throw new Error(
      "circuit, public-signal, or verifier sources are not committed; commit them or set MOROS_ALLOW_DIRTY=1 for a disposable local build",
    );
  }
}

function compileAll() {
  cleanOutput();
  const compileRecords = [];
  for (const circuit of CIRCUITS) {
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
    const info = parseR1csInfo(
      run("node", [snarkjs, "r1cs", "info", paths.r1cs]),
    );
    if (info.publicInputs !== circuit.publicSignals.length || info.outputs !== 0) {
      throw new Error(`${circuit.name} public-signal schema mismatch`);
    }
    compileRecords.push({
      name: circuit.name,
      code: circuit.code,
      public_inputs: info.publicInputs,
      constraints: info.constraints,
      wires: info.wires,
      required_ptau_power: Math.ceil(Math.log2(info.wires)),
      r1cs_sha256: sha256File(paths.r1cs),
      wasm_sha256: sha256File(paths.wasm),
      schema_sha256: schemaHash(circuit),
    });
    process.stdout.write(`compiled ${circuit.name}\n`);
  }
  const maximumPower = Math.max(
    ...compileRecords.map((record) => record.required_ptau_power),
  );
  if (maximumPower > requiredPower) {
    throw new Error(
      `circuits require Powers of Tau power ${maximumPower}, above the locked power ${requiredPower}`,
    );
  }
  writeFileSync(
    resolve(outputRoot, "compile-manifest.json"),
    `${JSON.stringify(
      {
        curve: "bn254",
        proof_system: "groth16",
        required_ptau_power: requiredPower,
        circuits: compileRecords,
      },
      null,
      2,
    )}\n`,
  );
}

function assertCompiled() {
  for (const circuit of CIRCUITS) {
    const paths = circuitPaths(circuit);
    if (!existsSync(paths.r1cs) || !existsSync(paths.wasm)) {
      throw new Error(`missing compiled artifacts for ${circuit.name}`);
    }
  }
}

async function setupAll() {
  if ((process.env.MOROS_NETWORK || "testnet") !== "testnet") {
    throw new Error("this single-contributor setup pipeline is testnet only");
  }
  const ptau = process.env.MOROS_PTAU;
  if (!ptau || !existsSync(ptau) || !statSync(ptau).isFile()) {
    throw new Error("MOROS_PTAU must point to a BN254 power 18 phase-2 ptau file");
  }
  const snarkjsPackage = JSON.parse(
    readFileSync(resolve(nodeModules, "snarkjs/package.json"), "utf8"),
  );
  const ptauBlake2b = await hashFile(ptau, "blake2b512");
  if (
    ptauBlake2b !== trustedPtauBlake2b &&
    process.env.MOROS_ALLOW_CUSTOM_PTAU !== "1"
  ) {
    throw new Error("Powers of Tau BLAKE2b hash is not the reviewed power 18 transcript");
  }
  const ptauSha256 = await hashFile(ptau, "sha256");
  const verificationReceiptPath = `${ptau}.snarkjs-verify.json`;
  let verified = false;
  if (existsSync(verificationReceiptPath)) {
    const receipt = JSON.parse(
      readFileSync(verificationReceiptPath, "utf8"),
    );
    verified =
      receipt.ptau_sha256 === ptauSha256 &&
      receipt.ptau_blake2b === ptauBlake2b &&
      receipt.snarkjs_version === snarkjsPackage.version &&
      receipt.command === "snarkjs powersoftau verify";
  }
  if (!verified) {
    run("node", [snarkjs, "powersoftau", "verify", ptau]);
    writeFileSync(
      verificationReceiptPath,
      `${JSON.stringify({
        ptau_sha256: ptauSha256,
        ptau_blake2b: ptauBlake2b,
        snarkjs_version: snarkjsPackage.version,
        command: "snarkjs powersoftau verify",
      }, null, 2)}\n`,
    );
  }
  assertCompiled();
  assertCircuitSourcesCommitted();
  const compileManifest = JSON.parse(
    readFileSync(resolve(outputRoot, "compile-manifest.json"), "utf8"),
  );
  const circomVersion = toolVersion("circom", ["--version"]);
  const circomlibPackage = JSON.parse(
    readFileSync(resolve(nodeModules, "circomlib/package.json"), "utf8"),
  );
  if (circomlibPackage.version !== "2.0.5") {
    throw new Error("unreviewed circomlib version");
  }
  const setupLabel =
    process.env.MOROS_SETUP_LABEL ||
    "moros-testnet-development-single-contributor-only";
  const sourceCommit = gitCommit();
  const entries = [];
  for (const circuit of CIRCUITS) {
    const paths = circuitPaths(circuit);
    const beacon = randomBytes(32).toString("hex");
    run("node", [
      snarkjs,
      "groth16",
      "setup",
      paths.r1cs,
      ptau,
      paths.initialZkey,
    ]);
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
    run("node", [
      snarkjs,
      "zkey",
      "verify",
      "r1cs",
      paths.r1cs,
      ptau,
      paths.zkey,
    ]);
    run("node", [
      snarkjs,
      "zkey",
      "export",
      "verificationkey",
      paths.zkey,
      paths.vkey,
    ]);
    const vkey = JSON.parse(readFileSync(paths.vkey, "utf8"));
    const key = keyPayloadJson(circuit, vkey);
    writeFileSync(paths.key, `${JSON.stringify(key, null, 2)}\n`);
    const compiled = compileManifest.circuits.find(
      (entry) => entry.name === circuit.name,
    );
    entries.push({
      ...compiled,
      prover: circuit.prover,
      source: relative(repo, resolve(sourceRoot, `${circuit.name}.circom`)),
      source_sha256: sha256File(
        resolve(sourceRoot, `${circuit.name}.circom`),
      ),
      schema: schema(circuit),
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
  const manifest = {
    format: 1,
    network: "testnet",
    mainnet_ready: false,
    setup_label: setupLabel,
    curve: "bn254",
    proof_system: "groth16",
    proof_encoding: "A(X,Y)||B(X.c1,X.c0,Y.c1,Y.c0)||C(X,Y)",
    required_ptau_power: requiredPower,
    ptau_sha256: ptauSha256,
    ptau_blake2b: ptauBlake2b,
    source_commit: sourceCommit,
    source_bundle_sha256: sourceBundleHash(),
    circom_version: circomVersion,
    snarkjs_version: snarkjsPackage.version,
    circomlib_version: circomlibPackage.version,
    circomlib_source_commit: "cff5ab6288b55ef23602221694a6a38a0239dcc0",
    reproducible_build_command:
      "MOROS_NETWORK=testnet MOROS_PTAU=/absolute/path/to/power18_final.ptau npm run setup:private",
    circuits: entries,
  };
  writeFileSync(
    resolve(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function packageArtifacts() {
  const manifestPath = resolve(outputRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("run setup before packaging artifacts");
  }
  const publicRoot = resolve(outputRoot, "public");
  rmSync(publicRoot, { recursive: true, force: true });
  mkdirSync(publicRoot, { recursive: true });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.setup_manifest_sha256 = sha256File(manifestPath);
  for (const circuit of CIRCUITS) {
    const paths = circuitPaths(circuit);
    const destination = resolve(publicRoot, circuit.name);
    mkdirSync(destination, { recursive: true });
    cpSync(paths.wasm, resolve(destination, `${circuit.name}.wasm`));
    cpSync(paths.zkey, resolve(destination, `${circuit.name}.zkey`));
    cpSync(paths.vkey, resolve(destination, `${circuit.name}.vk.json`));
  }
  manifest.circuits = manifest.circuits.map((entry) => ({
    ...entry,
    artifacts: {
      wasm: `${entry.name}/${entry.name}.wasm`,
      proving_key: `${entry.name}/${entry.name}.zkey`,
      verification_key: `${entry.name}/${entry.name}.vk.json`,
    },
  }));
  writeFileSync(
    resolve(publicRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

if (!["compile", "setup", "package", "all"].includes(command)) {
  throw new Error("usage: node private/build.mjs compile|setup|package|all");
}
if (command === "compile" || command === "all") compileAll();
if (command === "setup" || command === "all") await setupAll();
if (command === "package" || command === "all") packageArtifacts();
