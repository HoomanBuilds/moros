import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCUITS } from "./artifacts.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(path) {
  return sha256(readFileSync(path));
}

function contained(root, relative) {
  const path = resolve(root, relative || "");
  if (!relative || !path.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error("artifact path escapes its build root");
  }
  return path;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requireHash(path, expected, label) {
  if (!existsSync(path) || fileSha256(path) !== expected) {
    throw new Error(`${label} hash mismatch`);
  }
}

function linkOrCopy(source, target, expected, label) {
  requireHash(source, expected, label);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (fileSha256(target) === expected) return;
    copyFileSync(source, target);
  } else {
    try {
      linkSync(source, target);
    } catch {
      copyFileSync(source, target);
    }
  }
  requireHash(target, expected, label);
}

export function prepareMainnetArtifacts({
  sourceRoot,
  targetRoot,
  sourceCommit,
  releaseManifestPath,
}) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit || "")) {
    throw new Error("a full MOROS_SOURCE_COMMIT is required");
  }
  const sourceManifestPath = resolve(sourceRoot, "manifest.json");
  const sourcePublicRoot = resolve(sourceRoot, "public");
  const sourcePublicManifestPath = resolve(sourcePublicRoot, "manifest.json");
  const sourceManifest = readJson(sourceManifestPath);
  const sourcePublicManifest = readJson(sourcePublicManifestPath);
  if (
    sourceManifest.network !== "testnet" ||
    sourceManifest.mainnet_ready !== false ||
    sourceManifest.curve !== "bn254" ||
    sourceManifest.proof_system !== "groth16" ||
    sourceManifest.circuits?.length !== CIRCUITS.length ||
    sourcePublicManifest.setup_manifest_sha256 !==
      fileSha256(sourceManifestPath)
  ) {
    throw new Error("source proving package is not the accepted testnet package");
  }

  const targetPublicRoot = resolve(targetRoot, "public");
  for (const circuit of CIRCUITS) {
    const setupEntry = sourceManifest.circuits.find(
      (entry) => entry.name === circuit.name && entry.code === circuit.code,
    );
    const publicEntry = sourcePublicManifest.circuits?.find(
      (entry) => entry.name === circuit.name && entry.code === circuit.code,
    );
    if (!setupEntry || !publicEntry) {
      throw new Error(`${circuit.name} is missing from the proving package`);
    }

    const contractKeySource = contained(
      sourceRoot,
      setupEntry.artifacts?.contract_key,
    );
    const contractKeyTarget = contained(
      targetRoot,
      setupEntry.artifacts?.contract_key,
    );
    linkOrCopy(
      contractKeySource,
      contractKeyTarget,
      setupEntry.contract_key_sha256,
      `${circuit.name} contract key`,
    );

    for (const [kind, hashField] of [
      ["wasm", "wasm_sha256"],
      ["proving_key", "proving_key_sha256"],
      ["verification_key", "verification_key_sha256"],
    ]) {
      const relative = publicEntry.artifacts?.[kind];
      linkOrCopy(
        contained(sourcePublicRoot, relative),
        contained(targetPublicRoot, relative),
        publicEntry[hashField],
        `${circuit.name} ${kind}`,
      );
    }
  }

  const sourceManifestHash = fileSha256(sourceManifestPath);
  const mainnetManifest = {
    ...sourceManifest,
    network: "mainnet",
    mainnet_ready: true,
    setup_label: "moros-mainnet-accepted-current-setup",
    source_commit: sourceCommit,
    mainnet_packaging_command:
      "MOROS_SOURCE_COMMIT=<full commit> npm run prepare:mainnet",
    accepted_setup: {
      mode: "existing_single_contributor",
      source_network: "testnet",
      source_manifest_sha256: sourceManifestHash,
    },
  };
  const targetManifestPath = resolve(targetRoot, "manifest.json");
  writeJson(targetManifestPath, mainnetManifest);

  const mainnetPublicManifest = {
    ...sourcePublicManifest,
    network: "mainnet",
    mainnet_ready: true,
    setup_label: mainnetManifest.setup_label,
    source_commit: sourceCommit,
    mainnet_packaging_command: mainnetManifest.mainnet_packaging_command,
    accepted_setup: mainnetManifest.accepted_setup,
    setup_manifest_sha256: fileSha256(targetManifestPath),
  };
  const targetPublicManifestPath = resolve(targetPublicRoot, "manifest.json");
  writeJson(targetPublicManifestPath, mainnetPublicManifest);
  if (releaseManifestPath) {
    writeJson(releaseManifestPath, mainnetPublicManifest);
  }

  return {
    circuits: CIRCUITS.length,
    setupManifestSha256: mainnetPublicManifest.setup_manifest_sha256,
    sourceManifestSha256: sourceManifestHash,
    targetRoot,
  };
}

const here = dirname(fileURLToPath(import.meta.url));
if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const result = prepareMainnetArtifacts({
    sourceRoot: resolve(here, "../private-build"),
    targetRoot: resolve(here, "../private-mainnet-build"),
    sourceCommit: process.env.MOROS_SOURCE_COMMIT || "",
    releaseManifestPath: resolve(
      here,
      "../../deployments/private-mainnet-proving.json",
    ),
  });
  process.stdout.write(
    `mainnet proving artifacts ready: ${result.circuits} circuits, manifest ${result.setupManifestSha256}\n`,
  );
}
