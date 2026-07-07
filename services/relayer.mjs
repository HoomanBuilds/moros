import { spawnSync } from "child_process";
import { cfg } from "./config.mjs";

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} failed: ${r.stderr || r.stdout}`);
  return r;
}

function hexFrom(kind, jsonPath) {
  const out = run(cfg.circom2soroban, [kind, jsonPath]).stdout;
  const lines = out.split("\n").filter((l) => /^[0-9a-f]{40,}$/.test(l.trim()));
  return lines[lines.length - 1].trim();
}

const [proofPath, publicPath, recipient] = process.argv.slice(2);
if (!proofPath || !publicPath || !recipient) {
  console.error("usage: node relayer.mjs <redeem_proof.json> <redeem_public.json> <recipient G...>");
  process.exit(1);
}

const proofHex = hexFrom("proof", proofPath);
const pubHex = hexFrom("public", publicPath);

if (!cfg.poolId) {
  console.log(JSON.stringify({ to: recipient, proofHex, pubHex }, null, 2));
  process.exit(0);
}

console.log("[relayer] submitting redeem_order to", cfg.poolId, "for", recipient);
const r = run("stellar", [
  "contract", "invoke", "--id", cfg.poolId,
  "--source", cfg.source, "--network", cfg.network, "--send=yes", "--",
  "redeem_order", "--to", recipient,
  "--proof_bytes", proofHex, "--pub_signals_bytes", pubHex,
]);
console.log("[relayer] done:", (r.stdout + r.stderr).split("\n").find((l) => l.includes("transfer") || l.includes("Success")) || "submitted");
