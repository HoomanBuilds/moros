import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { resolve, dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { rpc, xdr, scValToNative } from "@stellar/stellar-sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const TREE_PROOF = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/tree_proof");
const LEDGER_WINDOW = 17000;

export function createIndexer({ rpcUrl, poolId, depth = 16 }) {
  const server = new rpc.Server(rpcUrl);
  const leaves = [];
  const indexByCommitment = new Map();

  async function poll(fromLedger) {
    const latest = await server.getLatestLedger();
    if (!poolId) return latest.sequence;
    const start = fromLedger || Math.max(latest.sequence - LEDGER_WINDOW, 1);
    const res = await server.getEvents({
      startLedger: start,
      filters: [{ type: "contract", contractIds: [poolId], topics: [[xdr.ScVal.scvSymbol("order_placed").toXDR("base64")]] }],
    });
    for (const ev of res.events || []) {
      const commitment = BigInt("0x" + Buffer.from(scValToNative(ev.topic[1])).toString("hex")).toString();
      const index = Number(scValToNative(ev.value)[0]);
      if (!indexByCommitment.has(commitment)) {
        leaves[index] = commitment;
        indexByCommitment.set(commitment, index);
      }
    }
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
      const out = JSON.parse(spawnSync(TREE_PROOF, [file], { encoding: "utf8" }).stdout);
      const idx = indexByCommitment.get(commitment);
      return { pathIndex: String(idx), siblings: out.proofs[idx].siblings, orderRoot: out.orderRoot };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return { poll, proofFor, size: () => indexByCommitment.size };
}
