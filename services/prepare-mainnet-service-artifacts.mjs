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
import { CIRCUITS } from "../circuits/private/artifacts.mjs";
import { cfg } from "./config.mjs";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function contained(root, relative) {
  const path = resolve(root, relative || "");
  if (!relative || !path.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error("artifact path escapes its public root");
  }
  return path;
}

function linkOrCopy(source, target, expected) {
  if (!existsSync(source) || sha256(source) !== expected) {
    throw new Error("source proving artifact hash mismatch");
  }
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (sha256(target) === expected) return;
    copyFileSync(source, target);
  } else {
    try {
      linkSync(source, target);
    } catch {
      copyFileSync(source, target);
    }
  }
  if (sha256(target) !== expected) {
    throw new Error("mainnet proving artifact hash mismatch");
  }
}

export function prepareMainnetServiceArtifacts({
  sourceRoot,
  targetRoot,
  manifestPath,
}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.network !== "mainnet" ||
    manifest.mainnet_ready !== true ||
    manifest.circuits?.length !== CIRCUITS.length
  ) {
    throw new Error("mainnet public proving manifest is invalid");
  }
  for (const circuit of CIRCUITS) {
    const entry = manifest.circuits.find(
      (candidate) =>
        candidate.name === circuit.name &&
        candidate.code === circuit.code,
    );
    if (!entry) {
      throw new Error(`${circuit.name} is missing from the mainnet manifest`);
    }
    for (const [kind, hashField] of [
      ["wasm", "wasm_sha256"],
      ["proving_key", "proving_key_sha256"],
      ["verification_key", "verification_key_sha256"],
    ]) {
      const relative = entry.artifacts?.[kind];
      linkOrCopy(
        contained(sourceRoot, relative),
        contained(targetRoot, relative),
        entry[hashField],
      );
    }
  }
  writeFileSync(
    resolve(targetRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return CIRCUITS.length;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const count = prepareMainnetServiceArtifacts({
    sourceRoot: resolve(cfg.repo, "circuits/private-build/public"),
    targetRoot: resolve(cfg.repo, "circuits/private-mainnet-build/public"),
    manifestPath: resolve(
      cfg.repo,
      "deployments/private-mainnet-proving.json",
    ),
  });
  process.stdout.write(
    `mainnet service proving artifacts ready: ${count} circuits\n`,
  );
}
