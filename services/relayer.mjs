import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
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

export function relay(proofPath, publicPath, recipient) {
  const proofHex = hexFrom("proof", proofPath);
  const pubHex = hexFrom("public", publicPath);
  if (!cfg.poolId) {
    return { dryRun: true, to: recipient, proofHex, pubHex };
  }
  const relayerAddr = run("stellar", ["keys", "address", cfg.source]).stdout.trim();
  const r = run("stellar", [
    "contract", "invoke", "--id", cfg.poolId,
    "--source", cfg.source, "--network", cfg.network, "--send=yes", "--",
    "redeem_order_v2", "--to", recipient, "--relayer", relayerAddr,
    "--proof_bytes", proofHex, "--pub_signals_bytes", pubHex,
  ]);
  const line = (r.stdout + r.stderr).split("\n").find((l) => l.includes("transfer") || l.includes("Success"));
  return { submitted: line || "done" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [proofPath, publicPath, recipient] = process.argv.slice(2);
  if (!proofPath || !publicPath || !recipient) {
    console.error("usage: node relayer.mjs <redeem_proof.json> <redeem_public.json> <recipient G...>");
    process.exit(1);
  }
  console.log("[relayer]", JSON.stringify(relay(proofPath, publicPath, recipient), null, 2));
}
