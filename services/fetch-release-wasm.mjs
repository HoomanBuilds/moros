import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpc } from "@stellar/stellar-sdk";
import { cfg } from "./config.mjs";

export const RELEASE_WASM_FILES = {
  verifier: "zk_verifier.wasm",
  resolver: "resolver.wasm",
  resolverRegistry: "resolver_registry.wasm",
  sharedVault: "shielded_collateral_vault.wasm",
  liquidityPool: "pooled_liquidity_vault.wasm",
  factory: "market_factory.wasm",
  market: "lmsr_market.wasm",
  liquidityVault: "market_liquidity_vault.wasm",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fetchReleaseWasm({
  server,
  deployment,
  outputRoot,
}) {
  if (
    deployment?.network !== "testnet" ||
    deployment.mainnetReady !== false
  ) {
    throw new Error("release WASM source must be the verified testnet deployment");
  }
  mkdirSync(outputRoot, { recursive: true });
  const hashes = {};
  for (const [name, file] of Object.entries(RELEASE_WASM_FILES)) {
    const expected = deployment.wasm?.[name];
    if (!/^[0-9a-f]{64}$/u.test(expected || "")) {
      throw new Error(`${name} release WASM hash is missing`);
    }
    const wasm = Buffer.from(
      await server.getContractWasmByHash(Buffer.from(expected, "hex")),
    );
    if (sha256(wasm) !== expected) {
      throw new Error(`${name} release WASM hash mismatch`);
    }
    const path = resolve(outputRoot, file);
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, wasm);
    renameSync(temporary, path);
    hashes[name] = expected;
  }
  return hashes;
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || "") === currentFile) {
  const deploymentPath = resolve(
    cfg.repo,
    process.env.MOROS_TESTNET_DEPLOYMENT ||
      "deployments/private-testnet.json",
  );
  if (!existsSync(deploymentPath)) {
    throw new Error("verified testnet deployment manifest is missing");
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const server = new rpc.Server(
    process.env.MOROS_TESTNET_RPC_URL ||
      "https://soroban-testnet.stellar.org",
  );
  const outputRoot = resolve(
    cfg.repo,
    "contracts/target/wasm32v1-none/release",
  );
  const hashes = await fetchReleaseWasm({
    server,
    deployment,
    outputRoot,
  });
  process.stdout.write(
    `release WASM ready: ${Object.keys(hashes).length} verified contracts\n`,
  );
}
