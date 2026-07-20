import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { resolve, dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { rpc, xdr, scValToNative } from "@stellar/stellar-sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const TREE_PROOF = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/tree_proof");
const LEDGER_WINDOW = 9000;

export function createIndexer({ rpcUrl, poolId, depth = 16, stateFile = "" }) {
  const server = new rpc.Server(rpcUrl);
  let leaves = [];
  let lastLedger = 0;
  const indexByCommitment = new Map();

  function rebuildIndex() {
    indexByCommitment.clear();
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i] !== undefined && leaves[i] !== null) indexByCommitment.set(String(leaves[i]), i);
    }
  }

  function persist() {
    if (!stateFile) return;
    mkdirSync(dirname(stateFile), { recursive: true });
    const tmp = `${stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ poolId, depth, lastLedger, leaves }), { mode: 0o600 });
    renameSync(tmp, stateFile);
  }

  if (stateFile && existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, "utf8"));
      if (saved.poolId === poolId && saved.depth === depth && Array.isArray(saved.leaves)) {
        leaves = saved.leaves;
        lastLedger = Number(saved.lastLedger || 0);
        rebuildIndex();
      }
    } catch {}
  }

  async function poll(fromLedger) {
    const latest = await server.getLatestLedger();
    if (!poolId) return latest.sequence;
    const start = fromLedger || (lastLedger > 0 ? lastLedger + 1 : Math.max(latest.sequence - LEDGER_WINDOW, 1));
    if (start > latest.sequence) return latest.sequence;
    const res = await server.getEvents({
      startLedger: start,
      pagination: { limit: 10_000 },
      filters: [{ type: "contract", contractIds: [poolId], topics: [[xdr.ScVal.scvSymbol("order_placed").toXDR("base64"), "*"]] }],
    });
    for (const ev of res.events || []) {
      const commitment = BigInt("0x" + Buffer.from(scValToNative(ev.topic[1])).toString("hex")).toString();
      const index = Number(scValToNative(ev.value)[0]);
      leaves[index] = commitment;
      if (!indexByCommitment.has(commitment)) indexByCommitment.set(commitment, index);
    }
    lastLedger = Number(res.latestLedger || latest.sequence);
    persist();
    return latest.sequence;
  }

  function proofFor(commitment) {
    if (!indexByCommitment.has(commitment)) return null;
    const dense = [];
    for (let i = 0; i < leaves.length; i++) dense.push(leaves[i] ?? "0");
    const dir = mkdtempSync(join(tmpdir(), "tp-"));
    const file = join(dir, "leaves.json");
    try {
      writeFileSync(file, JSON.stringify({ depth, leaves: dense }), { mode: 0o600 });
      const result = spawnSync(TREE_PROOF, [file], { encoding: "utf8" });
      if (result.status !== 0 || !result.stdout) throw new Error(`tree proof failed: ${result.stderr || "no output"}`);
      const out = JSON.parse(result.stdout);
      const idx = indexByCommitment.get(commitment);
      return { pathIndex: String(idx), siblings: out.proofs[idx].siblings, orderRoot: out.orderRoot };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return { poll, proofFor, size: () => indexByCommitment.size };
}
