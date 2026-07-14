import http from "http";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { timingSafeEqual } from "crypto";
import * as snarkjs from "snarkjs";
import { cfg } from "./config.mjs";
import { relay } from "./relayer.mjs";
import { addCiphers } from "./committee/jubjub.mjs";
import { ensureDKG, collectPartials, attestEntry } from "./committee/coordinator.mjs";
import { submitCommitteeBatch } from "./committee/submit-multisig.mjs";
import { createIndexer } from "./indexer.mjs";

const PORT = Number(process.env.PORT || 8787);
const BATCH_N = Number(process.env.BATCH_N || 4);
const WINDOW_MS = Number(process.env.WINDOW_MS || 60000);
const MAX_PENDING = Number(process.env.MAX_PENDING || 1000);
const MAX_BODY = 256 * 1024;
const TOKEN = process.env.SERVICE_TOKEN || "";
const MEMBER_TOKEN = process.env.MEMBER_TOKEN || "";
const MEMBERS = (process.env.MEMBERS || "").split(",").filter(Boolean);
const THRESHOLD = Number(process.env.THRESHOLD || 2);
const MARKET = process.env.MARKET || "";
const DRY = process.env.DRY_RUN === "1";
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const POOLS_FILE = resolve(cfg.repo, "services", "pools.json");
const S = 1n << 32n;
if (!TOKEN) console.warn("[server] SERVICE_TOKEN unset - mutating endpoints are OPEN (dev only)");
if (MEMBERS.length === 0) {
  console.error("[server] MEMBERS unset - need committee member URLs");
  process.exit(1);
}

mkdirSync(cfg.work, { recursive: true });
const DEC = /^[0-9]{1,78}$/;
const CID = /^[A-Z0-9]{56}$/;
const VK = JSON.parse(readFileSync(resolve(cfg.repo, "contracts/shielded-pool/circuits/build/encrypt_order_vk.json"), "utf8"));

const members = Object.fromEntries(MEMBERS.map((url, k) => [k + 1, url]));
let dkg = null;
let pkDec = null;
const memberAddrs = {};

const pools = new Map();

function newPool(marketId, poolId) {
  return { marketId, poolId, indexer: createIndexer({ rpcUrl: RPC_URL, poolId }), pending: [], seen: new Set() };
}

function registerPool(marketId, poolId) {
  if (pools.has(poolId)) return pools.get(poolId);
  const p = newPool(marketId, poolId);
  pools.set(poolId, p);
  return p;
}

function savePools() {
  const list = [...pools.values()].map((p) => ({ marketId: p.marketId, poolId: p.poolId }));
  try { writeFileSync(POOLS_FILE, JSON.stringify(list, null, 2)); } catch {}
}

function loadPools() {
  if (MARKET && cfg.poolId) registerPool(MARKET, cfg.poolId);
  if (existsSync(POOLS_FILE)) {
    try {
      for (const p of JSON.parse(readFileSync(POOLS_FILE, "utf8"))) {
        if (CID.test(p.marketId || "") && CID.test(p.poolId || "")) registerPool(p.marketId, p.poolId);
      }
    } catch {}
  }
}

async function bootstrap() {
  for (const [i, url] of Object.entries(members)) {
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(`${url}/health`);
        if (r.ok) {
          const h = await r.json();
          if (h.address) memberAddrs[h.address] = url;
          break;
        }
      } catch {}
      if (k > 100) throw new Error(`member ${i} unreachable`);
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  dkg = await ensureDKG(members, THRESHOLD, MEMBER_TOKEN);
  pkDec = [dkg.pk[0].toString(), dkg.pk[1].toString()];
  console.log(`[server] committee ${dkg.reused ? "epoch REUSED" : "DKG complete"} (${MEMBERS.length} members, t=${THRESHOLD}); serving ${pools.size} pool(s)`);
}

function authed(req) {
  if (!TOKEN) return true;
  const h = req.headers["authorization"] || "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ptOf = (pub, at) => [BigInt(pub[at]), BigInt(pub[at + 1])];
const cipherJson = (c) => ({ c1: [c.c1[0].toString(), c.c1[1].toString()], c2: [c.c2[0].toString(), c.c2[1].toString()] });

const batching = new Set();
async function batchPool(pool) {
  if (batching.has(pool.poolId)) return { skipped: "in progress" };
  if (!dkg) return { skipped: "committee not ready" };
  if (pool.pending.length < BATCH_N) return { skipped: `need ${BATCH_N}, have ${pool.pending.length}` };
  batching.add(pool.poolId);
  try {
    const window = pool.pending.slice(0, BATCH_N);
    const netYes = addCiphers(window.map((o) => o.cyes));
    const netNo = addCiphers(window.map((o) => o.cno));
    const quorum = Object.fromEntries(Object.entries(members).slice(0, THRESHOLD));
    const yes = await collectPartials(quorum, dkg, netYes, MEMBER_TOKEN);
    const no = await collectPartials(quorum, dkg, netNo, MEMBER_TOKEN);
    if (yes.net === null || no.net === null) throw new Error("net decryption exceeded bound");
    console.log(`[server] pool ${pool.poolId} net: dqyes=${yes.net} dqno=${no.net}`);

    if (DRY || !pool.marketId || !process.env.FUNDER_SK) {
      pool.pending = pool.pending.slice(BATCH_N);
      return { dryRun: true, dqyes: yes.net.toString(), dqno: no.net.toString() };
    }
    const attestPayload = {
      cipherYes: cipherJson(netYes),
      cipherNo: cipherJson(netNo),
      partialsYes: yes.partials,
      partialsNo: no.partials,
      dqyes: yes.net.toString(),
      dqno: no.net.toString(),
    };
    const out = await submitCommitteeBatch({
      market: pool.marketId,
      poolId: pool.poolId,
      dqyes: (yes.net * S).toString(),
      dqno: (no.net * S).toString(),
      funderSk: process.env.FUNDER_SK,
      signerAddrs: Object.keys(memberAddrs).slice(0, THRESHOLD),
      attest: async ({ address, entryXdr, validUntilLedger }) => {
        const url = memberAddrs[address];
        if (!url) throw new Error(`no member service for signer ${address}`);
        const r = await attestEntry(url, { entryXdr, validUntilLedger, ...attestPayload }, MEMBER_TOKEN);
        return r.signedEntryXdr;
      },
    });
    pool.pending = pool.pending.slice(BATCH_N);
    console.log(`[server] pool ${pool.poolId} batch on-chain: tx ${out.hash}`);
    return { batched: BATCH_N, tx: out.hash, net: out.net.toString() };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    batching.delete(pool.poolId);
  }
}

async function runAllWindows() {
  const out = {};
  for (const pool of pools.values()) {
    const r = await batchPool(pool);
    if (r.batched || r.dryRun) out[pool.poolId] = r;
  }
  return out;
}

setInterval(async () => {
  const r = await runAllWindows();
  if (Object.keys(r).length) console.log("[server] window:", JSON.stringify(r));
}, WINDOW_MS);

setInterval(() => {
  for (const pool of pools.values()) pool.indexer.poll().catch((e) => console.warn(`[server] poll ${pool.poolId} failed:`, String(e.message || e)));
}, 20000);

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
      return send(200, {
        committee: { members: MEMBERS.length, threshold: THRESHOLD, ready: !!dkg },
        batchN: BATCH_N, windowMs: WINDOW_MS,
        pools: [...pools.values()].map((p) => ({ market: p.marketId, pool: p.poolId, pending: p.pending.length })),
      });
    }
    if (req.method === "GET" && req.url === "/pk") {
      if (!pkDec) return send(503, { error: "committee not ready" });
      return send(200, { pk: pkDec, note: "encrypt orders to this epoch key; prove with encrypt_order.circom" });
    }
    if (req.method === "GET" && req.url.startsWith("/proof/")) {
      const commitment = req.url.slice("/proof/".length);
      for (const pool of pools.values()) {
        await pool.indexer.poll().catch(() => {});
        const p = pool.indexer.proofFor(commitment);
        if (p) return send(200, { ...p, poolId: pool.poolId });
      }
      return send(404, { error: "commitment not indexed yet" });
    }
    if (req.method !== "POST") return send(404, { error: "not found" });
    if (!authed(req)) return send(401, { error: "unauthorized" });

    if (req.url === "/register-pool") {
      const o = await readBody(req);
      if (!CID.test(o.marketId || "") || !CID.test(o.poolId || "")) return send(400, { error: "need valid marketId and poolId" });
      const p = registerPool(o.marketId, o.poolId);
      savePools();
      await p.indexer.poll().catch(() => {});
      return send(200, { registered: true, pool: o.poolId, market: o.marketId, pools: pools.size });
    }
    if (req.url === "/order") {
      if (!pkDec) return send(503, { error: "committee not ready" });
      const o = await readBody(req);
      const pool = pools.get(o.poolId);
      if (!pool) return send(404, { error: "pool not registered with this committee" });
      if (!o.proof || !Array.isArray(o.publicSignals) || o.publicSignals.length !== 13) {
        return send(400, { error: "need proof and 13 publicSignals" });
      }
      for (const s of o.publicSignals) {
        if (typeof s !== "string" || !DEC.test(s)) return send(400, { error: "publicSignals must be decimal strings" });
      }
      if (o.publicSignals[11] !== pkDec[0] || o.publicSignals[12] !== pkDec[1]) {
        return send(400, { error: "order not encrypted to the current committee pk (GET /pk)" });
      }
      const nullifierHash = o.publicSignals[1];
      if (pool.seen.has(nullifierHash)) return send(409, { error: "nullifier already queued or batched" });
      if (pool.pending.length >= MAX_PENDING) return send(429, { error: "pending queue full" });

      const ok = await snarkjs.groth16.verify(VK, o.publicSignals, o.proof);
      if (!ok) return send(400, { error: "encryption-validity proof rejected" });

      pool.seen.add(nullifierHash);
      pool.pending.push({
        commitment: o.publicSignals[0],
        nullifierHash,
        cyes: { c1: ptOf(o.publicSignals, 2), c2: ptOf(o.publicSignals, 4) },
        cno: { c1: ptOf(o.publicSignals, 6), c2: ptOf(o.publicSignals, 8) },
      });
      return send(200, { queued: true, pending: pool.pending.length, note: "server holds ciphertexts only" });
    }
    if (req.url === "/batch") {
      const o = await readBody(req);
      if (o.poolId) {
        const pool = pools.get(o.poolId);
        if (!pool) return send(404, { error: "pool not registered" });
        return send(200, await batchPool(pool));
      }
      return send(200, await runAllWindows());
    }
    if (req.url === "/redeem") {
      const o = await readBody(req);
      if (!o.proof || !o.public || typeof o.recipient !== "string") return send(400, { error: "need proof, public, recipient" });
      const poolId = o.poolId && pools.has(o.poolId) ? o.poolId : cfg.poolId;
      const pf = resolve(cfg.work, "redeem_proof.json");
      const pu = resolve(cfg.work, "redeem_public.json");
      try {
        writeFileSync(pf, JSON.stringify(o.proof));
        writeFileSync(pu, JSON.stringify(o.public));
        return send(200, relay(pf, pu, o.recipient, { poolId }));
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

loadPools();
for (const pool of pools.values()) await pool.indexer.poll().catch(() => {});
await bootstrap();
server.listen(PORT, () =>
  console.log(`[server] no-leak multi-pool committee on :${PORT} (batchN=${BATCH_N}, window=${WINDOW_MS}ms, pools=${pools.size}, auth=${TOKEN ? "on" : "OFF"})`)
);
