import http from "http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { cfg } from "./config.mjs";
import { batch } from "./batcher.mjs";
import { relay } from "./relayer.mjs";

const PORT = Number(process.env.PORT || 8787);
const BATCH_N = Number(process.env.BATCH_N || 4);
const WINDOW_MS = Number(process.env.WINDOW_MS || 60000);

mkdirSync(cfg.work, { recursive: true });
const PENDING = resolve(cfg.work, "pending-orders.json");
let pending = existsSync(PENDING) ? JSON.parse(readFileSync(PENDING, "utf8")) : [];
const save = () => writeFileSync(PENDING, JSON.stringify(pending));

let batching = false;
function runBatch() {
  if (batching) return { skipped: "batch in progress" };
  if (pending.length < BATCH_N) return { skipped: `need ${BATCH_N} orders, have ${pending.length}` };
  batching = true;
  try {
    const orders = pending.slice(0, BATCH_N);
    const ordersFile = resolve(cfg.work, "window-orders.json");
    writeFileSync(ordersFile, JSON.stringify(orders));
    batch(ordersFile);
    pending = pending.slice(BATCH_N);
    save();
    return { batched: BATCH_N, remaining: pending.length };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    batching = false;
  }
}

setInterval(() => {
  const r = runBatch();
  if (r.batched) console.log("[server] window batch:", r);
}, WINDOW_MS);

function readBody(req) {
  return new Promise((res, rej) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try { res(d ? JSON.parse(d) : {}); } catch (e) { rej(e); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === "GET" && req.url === "/status") {
      return send(200, { pending: pending.length, batchN: BATCH_N, windowMs: WINDOW_MS, pool: cfg.poolId || null });
    }
    if (req.method === "POST" && req.url === "/order") {
      const o = await readBody(req);
      for (const k of ["amount", "side", "secret", "nullifier"]) {
        if (typeof o[k] !== "string") return send(400, { error: `missing string field: ${k}` });
      }
      pending.push({ amount: o.amount, side: o.side, secret: o.secret, nullifier: o.nullifier });
      save();
      return send(200, { queued: true, pending: pending.length });
    }
    if (req.method === "POST" && req.url === "/batch") {
      return send(200, runBatch());
    }
    if (req.method === "POST" && req.url === "/redeem") {
      const o = await readBody(req);
      if (!o.proof || !o.public || !o.recipient) return send(400, { error: "need proof, public, recipient" });
      const pf = resolve(cfg.work, "redeem_proof.json");
      const pu = resolve(cfg.work, "redeem_public.json");
      writeFileSync(pf, JSON.stringify(o.proof));
      writeFileSync(pu, JSON.stringify(o.public));
      return send(200, relay(pf, pu, o.recipient));
    }
    return send(404, { error: "not found" });
  } catch (e) {
    return send(500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`[server] batcher/relayer on :${PORT} (batchN=${BATCH_N}, window=${WINDOW_MS}ms, pool=${cfg.poolId || "unset"})`)
);
