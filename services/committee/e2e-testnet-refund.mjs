import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const poolId = process.env.POOL_ID;
const tokenId = process.env.TOKEN_ID || "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const source = process.env.SOURCE || "deployer";
const orders = JSON.parse(process.env.ORDERS_JSON || "[]");

if (!poolId || orders.length === 0) throw new Error("Set POOL_ID and ORDERS_JSON");

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function invoke(contractId, method, args = []) {
  return run("stellar", ["contract", "invoke", "--id", contractId, "--source", source, "--network", "testnet", "--", method, ...args])
    .trim()
    .split("\n")
    .at(-1);
}

function balance(address) {
  return BigInt(invoke(tokenId, "balance", ["--id", address]).replaceAll('"', ""));
}

const owner = run("stellar", ["keys", "address", source]).trim();
const before = balance(owner);
const work = mkdtempSync(resolve(tmpdir(), "moros-testnet-refund-"));
let expected = 0n;

try {
  for (const [index, order] of orders.entries()) {
    const inputPath = resolve(work, `input-${index}.json`);
    const witnessPath = resolve(work, `witness-${index}.wtns`);
    const witnessJsonPath = resolve(work, `witness-${index}.json`);
    writeFileSync(inputPath, JSON.stringify({
      amount: order.amount,
      side: order.side,
      secret: order.secret,
      nullifier: order.nullifier,
    }));
    run("node", [resolve(CIRC, "build/order_commit_js/generate_witness.js"), resolve(CIRC, "build/order_commit_js/order_commit.wasm"), inputPath, witnessPath]);
    run(SNARKJS, ["wtns", "export", "json", witnessPath, witnessJsonPath]);
    const commitment = BigInt(JSON.parse(readFileSync(witnessJsonPath, "utf8"))[1]).toString(16).padStart(64, "0");
    const stakeAtomic = BigInt(order.stakeAmount ?? order.amount) * 10_000_000n;
    invoke(poolId, "refund_order", ["--owner", owner, "--commitment", commitment]);
    expected += stakeAtomic;

    let replayRejected = false;
    try {
      invoke(poolId, "refund_order", ["--owner", owner, "--commitment", commitment]);
    } catch {
      replayRejected = true;
    }
    if (!replayRejected) throw new Error(`order ${index} refund replay was accepted`);
    console.log(JSON.stringify({ index, refundedAtomic: stakeAtomic.toString() }));
  }

  const received = balance(owner) - before;
  if (received !== expected) throw new Error(`refund mismatch: ${received} != ${expected}`);
  console.log(JSON.stringify({ orders: orders.length, refundedAtomic: received.toString(), replayProtected: true }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
