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

export function relay(proofPath, publicPath, recipient, opts = {}) {
  const poolId = opts.poolId ?? cfg.poolId;
  const source = opts.source ?? cfg.source;
  const proofHex = hexFrom("proof", proofPath);
  const pubHex = hexFrom("public", publicPath);
  if (!poolId) {
    return { dryRun: true, to: recipient, proofHex, pubHex };
  }
  const invokeArgs = [
    "contract", "invoke", "--id", poolId,
    "--source", source, "--network", cfg.network, "--send=yes", "--",
    "redeem_position", "--to", recipient,
  ];
  invokeArgs.push("--proof_bytes", proofHex, "--pub_signals_bytes", pubHex);
  const r = run("stellar", invokeArgs);
  const output = r.stdout + r.stderr;
  const hashes = output.match(/\b[0-9a-f]{64}\b/gi) ?? [];
  return { submitted: true, txHash: hashes.at(-1) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [proofPath, publicPath, recipient] = process.argv.slice(2);
  if (!proofPath || !publicPath || !recipient) {
    console.error("usage: node relayer.mjs <redeem_proof.json> <redeem_public.json> <recipient G...>");
    process.exit(1);
  }
  console.log("[relayer]", JSON.stringify(relay(proofPath, publicPath, recipient), null, 2));
}
