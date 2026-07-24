import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { CIRCUITS } from "./artifacts.mjs";
import { prepareMainnetArtifacts } from "./prepare-mainnet.mjs";
import { prepareMainnetServiceArtifacts } from "../../services/prepare-mainnet-service-artifacts.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

const root = mkdtempSync(resolve(tmpdir(), "moros-mainnet-artifacts-"));
const sourceRoot = resolve(root, "source");
const targetRoot = resolve(root, "target");
const setupCircuits = [];
const publicCircuits = [];

for (const circuit of CIRCUITS) {
  const files = {
    wasm: Buffer.from(`${circuit.name}-wasm`),
    proving_key: Buffer.from(`${circuit.name}-zkey`),
    verification_key: Buffer.from(`${circuit.name}-vkey`),
    contract_key: Buffer.from(`${circuit.name}-contract-key`),
  };
  const privateArtifacts = {
    wasm: `${circuit.name}/${circuit.name}_js/${circuit.name}.wasm`,
    proving_key: `${circuit.name}/${circuit.name}.zkey`,
    verification_key: `${circuit.name}/${circuit.name}.vk.json`,
    contract_key: `${circuit.name}/${circuit.name}.key.json`,
  };
  const publicArtifacts = {
    wasm: `${circuit.name}/${circuit.name}.wasm`,
    proving_key: `${circuit.name}/${circuit.name}.zkey`,
    verification_key: `${circuit.name}/${circuit.name}.vk.json`,
  };
  write(resolve(sourceRoot, privateArtifacts.contract_key), files.contract_key);
  for (const kind of ["wasm", "proving_key", "verification_key"]) {
    write(resolve(sourceRoot, "public", publicArtifacts[kind]), files[kind]);
  }
  const hashes = {
    wasm_sha256: sha256(files.wasm),
    proving_key_sha256: sha256(files.proving_key),
    verification_key_sha256: sha256(files.verification_key),
    contract_key_sha256: sha256(files.contract_key),
  };
  setupCircuits.push({
    name: circuit.name,
    code: circuit.code,
    ...hashes,
    artifacts: privateArtifacts,
  });
  publicCircuits.push({
    name: circuit.name,
    code: circuit.code,
    ...hashes,
    artifacts: publicArtifacts,
  });
}

const sourceManifest = {
  network: "testnet",
  mainnet_ready: false,
  curve: "bn254",
  proof_system: "groth16",
  circuits: setupCircuits,
};
const sourceManifestPath = resolve(sourceRoot, "manifest.json");
write(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
write(
  resolve(sourceRoot, "public/manifest.json"),
  `${JSON.stringify({
    ...sourceManifest,
    circuits: publicCircuits,
    setup_manifest_sha256: sha256(readFileSync(sourceManifestPath)),
  }, null, 2)}\n`,
);

const sourceCommit = "1".repeat(40);
const releaseManifestPath = resolve(root, "mainnet-public.json");
const result = prepareMainnetArtifacts({
  sourceRoot,
  targetRoot,
  sourceCommit,
  releaseManifestPath,
});
assert.equal(result.circuits, CIRCUITS.length);
const mainnetManifest = JSON.parse(
  readFileSync(resolve(targetRoot, "manifest.json"), "utf8"),
);
const publicManifest = JSON.parse(
  readFileSync(resolve(targetRoot, "public/manifest.json"), "utf8"),
);
assert.equal(mainnetManifest.network, "mainnet");
assert.equal(mainnetManifest.mainnet_ready, true);
assert.equal(mainnetManifest.source_commit, sourceCommit);
assert.equal(publicManifest.network, "mainnet");
assert.equal(
  publicManifest.setup_manifest_sha256,
  sha256(readFileSync(resolve(targetRoot, "manifest.json"))),
);
const serviceRoot = resolve(root, "service");
assert.equal(
  prepareMainnetServiceArtifacts({
    sourceRoot: resolve(sourceRoot, "public"),
    targetRoot: serviceRoot,
    manifestPath: releaseManifestPath,
  }),
  CIRCUITS.length,
);
assert.equal(
  JSON.parse(
    readFileSync(resolve(serviceRoot, "manifest.json"), "utf8"),
  ).network,
  "mainnet",
);
assert.throws(
  () => prepareMainnetArtifacts({
    sourceRoot,
    targetRoot,
    sourceCommit: "short",
  }),
  /full MOROS_SOURCE_COMMIT/,
);

console.log("mainnet proving package ok");
