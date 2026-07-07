import http from "http";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { timingSafeEqual } from "crypto";
import { cfg } from "./config.mjs";
import { batch } from "./batcher.mjs";
import { relay } from "./relayer.mjs";

const PORT = Number(process.env.PORT || 8787);
const BATCH_N = Number(process.env.BATCH_N || 4);
const WINDOW_MS = Number(process.env.WINDOW_MS || 60000);
const MAX_PENDING = Number(process.env.MAX_PENDING || 1000);
const MAX_BODY = 256 * 1024;
const TOKEN = process.env.SERVICE_TOKEN || "";
if (!TOKEN) console.warn("[server] SERVICE_TOKEN unset - mutating endpoints are OPEN (dev only)");

mkdirSync(cfg.work, { recursive: true });
const DEC = /^[0-9]{1,78}$/;
let pending = [];

function authed(req) {
  if (!TOKEN) return true;
  const h = req.headers["authorization"] || "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

let batching = false;
function runBatch() {
  if (batching) return { skipped: "batch in progress" };
  if (pending.length < BATCH_N) return { skipped: `need ${BATCH_N} orders, have ${pending.length}` };
  batching = true;
  const ordersFile = resolve(cfg.work, "window-orders.json");
  try {
    const orders = pending.slice(0, BATCH_N);
    writeFileSync(ordersFile, JSON.stringify(orders));
    batch(ordersFile);
    pending = pending.slice(BATCH_N);
    return { batched: BATCH_N, remaining: pending.length };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    rmSync(ordersFile, { force: true });
    batching = false;
  }
}

setInterval(() => {
  const r = runBatch();
  if (r.batched) console.log("[server] window batch:", r);
}, WINDOW_MS);

function readBody(req) {
  return new Promise((res, rej) => {
    let d = "", n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) { rej(new Error("body too large")); req.destroy(); return; }
      d += c;
    });
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
    if (req.method !== "POST") return send(404, { error: "not found" });
    if (!authed(req)) return send(401, { error: "unauthorized" });

    if (req.url === "/order") {
      const o = await readBody(req);
      for (const k of ["amount", "side", "secret", "nullifier"]) {
        if (typeof o[k] !== "string" || !DEC.test(o[k])) return send(400, { error: `invalid decimal field: ${k}` });
      }
      if (o.side !== "0" && o.side !== "1") return send(400, { error: "side must be 0 or 1" });
      if (pending.length >= MAX_PENDING) return send(429, { error: "pending queue full" });
      pending.push({ amount: o.amount, side: o.side, secret: o.secret, nullifier: o.nullifier });
      return send(200, { queued: true, pending: pending.length });
    }
    if (req.url === "/batch") {
      return send(200, runBatch());
    }
    if (req.url === "/redeem") {
      const o = await readBody(req);
      if (!o.proof || !o.public || typeof o.recipient !== "string") return send(400, { error: "need proof, public, recipient" });
      const pf = resolve(cfg.work, "redeem_proof.json");
      const pu = resolve(cfg.work, "redeem_public.json");
      try {
        writeFileSync(pf, JSON.stringify(o.proof));
        writeFileSync(pu, JSON.stringify(o.public));
        return send(200, relay(pf, pu, o.recipient));
      } finally {
        rmSync(pf, { force: true });
        rmSync(pu, { force: true });
      }
    }
    return send(404, { error: "not found" });
  } catch (e) {
    return send(400, { error: String(e.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`[server] batcher/relayer on :${PORT} (batchN=${BATCH_N}, window=${WINDOW_MS}ms, pool=${cfg.poolId || "unset"}, auth=${TOKEN ? "on" : "OFF"})`)
);
