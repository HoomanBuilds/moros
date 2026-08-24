import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { cfg } from "./config.mjs";
import { canonicalJson, sha256 } from "../circuits/private/artifacts.mjs";
import { PAYMENT_CIRCUITS } from "../circuits/payments/artifacts.mjs";

const ARTIFACT_ROOT = resolve(cfg.repo, "apps/pay-web/public/zk/payments");
const SOURCE_MANIFEST_PATH = resolve(ARTIFACT_ROOT, "manifest.json");
const OUTPUT_PATH = resolve(cfg.repo, "deployments/payments-mainnet-proving.json");

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sourceBundleHash() {
  const sources = PAYMENT_CIRCUITS
    .map(({ name }) => `${name}.circom`)
    .concat("payment_action.circom")
    .sort();
  return sha256(canonicalJson(sources.map((name) => [
    name,
    readFileSync(resolve(cfg.repo, "contracts/payment-circuits", name), "utf8"),
  ])));
}

async function main() {
  if (!existsSync(SOURCE_MANIFEST_PATH)) throw new Error("reviewed payment artifacts are missing");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "contracts/payment-circuits"], {
    cwd: cfg.repo,
    stdio: "ignore",
  });
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: cfg.repo,
    encoding: "utf8",
  }).trim();
  const reviewed = JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, "utf8"));
  if (
    reviewed.curve !== "bn254" ||
    reviewed.proof_system !== "groth16" ||
    reviewed.circuits?.length !== PAYMENT_CIRCUITS.length ||
    reviewed.source_bundle_sha256 !== sourceBundleHash()
  ) {
    throw new Error("reviewed payment manifest does not match the payment circuits");
  }
  for (const circuit of PAYMENT_CIRCUITS) {
    const entry = reviewed.circuits.find((candidate) => candidate.name === circuit.name);
    if (!entry || entry.code !== circuit.code) throw new Error(`missing ${circuit.name} artifacts`);
    const source = resolve(cfg.repo, "contracts/payment-circuits", `${entry.name}.circom`);
    const artifacts = [
      [resolve(ARTIFACT_ROOT, `${entry.name}.wasm`), entry.wasm_sha256],
      [resolve(ARTIFACT_ROOT, `${entry.name}.zkey`), entry.proving_key_sha256],
      [resolve(ARTIFACT_ROOT, `${entry.name}.vk.json`), entry.verification_key_sha256],
      [source, entry.source_sha256],
    ];
    for (const [path, expected] of artifacts) {
      if (!existsSync(path) || await sha256File(path) !== expected) {
        throw new Error(`${entry.name} artifact verification failed`);
      }
    }
  }
  const manifest = {
    ...reviewed,
    environment: "mainnet",
    network: "stellar:pubnet",
    mainnet_ready: true,
    source_commit: sourceCommit,
    reviewed_setup: {
      source_environment: reviewed.environment,
      source_setup_label: reviewed.setup_label,
      source_manifest_sha256: await sha256File(SOURCE_MANIFEST_PATH),
    },
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`prepared ${OUTPUT_PATH}\n`);
}

await main();
