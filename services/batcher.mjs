import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { cfg } from "./config.mjs";

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(`${bin} failed: ${r.stderr || r.stdout}`);
  }
  return r;
}

function hexFrom(kind, jsonPath) {
  const out = run(cfg.circom2soroban, [kind, jsonPath]).stdout;
  const lines = out.split("\n").filter((l) => /^[0-9a-f]{40,}$/.test(l.trim()));
  return lines[lines.length - 1].trim();
}

export function batch(ordersPath) {
  mkdirSync(cfg.work, { recursive: true });
  const inputPath = resolve(cfg.work, "batch_input.json");
  const wtns = resolve(cfg.work, "batch.wtns");
  const proofPath = resolve(cfg.work, "batch_proof.json");
  const publicPath = resolve(cfg.work, "batch_public.json");

  console.log("[batcher] building order tree + witness input from", ordersPath);
  const gen = spawnSync(cfg.batchBin, [ordersPath], { encoding: "utf8" });
  if (gen.status !== 0) throw new Error("batch generator failed: " + gen.stderr);
  writeFileSync(inputPath, gen.stdout);

  try {
    console.log("[batcher] generating witness");
    run("node", [cfg.batchWitnessGen, cfg.batchWasm, inputPath, wtns]);
    console.log("[batcher] proving (snarkjs groth16)");
    run(cfg.snarkjs, ["groth16", "prove", cfg.batchZkey, wtns, proofPath, publicPath]);

    const pub = JSON.parse(readFileSync(publicPath, "utf8"));
    const dqyes = pub[0];
    const dqno = pub[1];
    const proofHex = hexFrom("proof", proofPath);
    const pubHex = hexFrom("public", publicPath);
    console.log(`[batcher] net delta: dqyes=${dqyes} dqno=${dqno}`);

    if (!cfg.poolId) {
      console.log("[batcher] POOL_ID not set - printing submit args instead of submitting");
      console.log(JSON.stringify({ dqyes, dqno, proofHex, pubHex }, null, 2));
      return;
    }
    console.log("[batcher] submitting submit_batch to", cfg.poolId);
    const r = run("stellar", [
      "contract", "invoke", "--id", cfg.poolId,
      "--source", cfg.source, "--network", cfg.network, "--send=yes", "--",
      "submit_batch", "--dqyes", dqyes, "--dqno", dqno,
      "--proof_bytes", proofHex, "--pub_signals_bytes", pubHex,
    ]);
    console.log("[batcher] submitted:", (r.stdout + r.stderr).split("\n").find((l) => l.includes("batch") || l.includes("Success")) || "done");
  } finally {
    rmSync(inputPath, { force: true });
    rmSync(wtns, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ordersPath = process.argv[2] || resolve(cfg.repo, "services/orders.example.json");
  batch(ordersPath);
}
