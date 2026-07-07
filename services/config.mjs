import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync, readFileSync } from "fs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

function loadEnv() {
  const f = resolve(here, ".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const fork = resolve(repo, "inspiration/zk/soroban-privacy-pools");
const circuits = resolve(repo, "contracts/shielded-pool/circuits");

export const cfg = {
  repo,
  network: process.env.NETWORK || "testnet",
  source: process.env.SOURCE || "deployer",
  poolId: process.env.POOL_ID || "",
  batchBin: resolve(fork, "target/release/batch"),
  circom2soroban: resolve(fork, "target/release/stellar-circom2soroban"),
  snarkjs: resolve(repo, "circuits/node_modules/.bin/snarkjs"),
  batchWasm: resolve(circuits, "build/batch_js/batch.wasm"),
  batchWitnessGen: resolve(circuits, "build/batch_js/generate_witness.js"),
  batchZkey: resolve(circuits, "output/batch_final.zkey"),
  redeemZkey: resolve(circuits, "output/order_redeem_final.zkey"),
  work: process.env.WORK || "/tmp/batcher",
};
