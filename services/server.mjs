import http from "http";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { timingSafeEqual, createHash } from "crypto";
import * as snarkjs from "snarkjs";
import { rpc, TransactionBuilder, Contract, BASE_FEE, Keypair, Networks, scValToNative } from "@stellar/stellar-sdk";
import { cfg } from "./config.mjs";
import { relay } from "./relayer.mjs";
import { addCiphers } from "./committee/jubjub.mjs";
import { ensureDKG, collectPartials, attestEntry } from "./committee/coordinator.mjs";
import { submitPoolBatch } from "./committee/submit-multisig.mjs";
import { createIndexer } from "./indexer.mjs";
import { resolvableAssets } from "./oracle-config.mjs";

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
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const FUNDER_SK = process.env.FUNDER_SK || "";
const READER_ADDRESS = process.env.READER_ADDRESS || (FUNDER_SK ? Keypair.fromSecret(FUNDER_SK).publicKey() : "");
const statePath = (value, fallback) => value ? resolve(cfg.repo, value) : resolve(cfg.repo, "services", fallback);
const POOLS_FILE = statePath(process.env.POOLS_FILE, "pools.json");
const QUEUE_FILE = statePath(process.env.QUEUE_FILE, "queue.json");
const INDEXER_DIR = statePath(process.env.INDEXER_DIR, "indexer-data");
const KEEPER_STATUS_FILE = statePath(process.env.KEEPER_STATUS_FILE, "keeper-status.json");
const KEEPER_STALE_MS = Number(process.env.KEEPER_STALE_MS || 900000);
const POOL_WASM_HASH = (process.env.POOL_WASM_HASH || "").toLowerCase();
const MARKET_WASM_HASH = (process.env.MARKET_WASM_HASH || "").toLowerCase();
const COLLATERAL_ID = process.env.COLLATERAL_ID || "";
const ORACLE_MODE = process.env.ORACLE_MODE || "free";
const PRICE_RESOLVER_ID = ORACLE_MODE === "pyth_pro"
  ? process.env.PYTH_PRO_RESOLVER_ID || ""
  : process.env.FREE_RESOLVER_ID || "";
const RESOLVABLE_ASSETS = resolvableAssets(ORACLE_MODE);
const ALLOW_UNVERIFIED_REGISTRATION = process.env.ALLOW_UNVERIFIED_REGISTRATION === "1";
const MAX_POOLS = Number(process.env.MAX_POOLS || 1000);
const S = 1n << 32n;
if (BATCH_N !== 4) throw new Error("BATCH_N must be 4 for private batches");
if (!ALLOW_UNVERIFIED_REGISTRATION && (!POOL_WASM_HASH || !MARKET_WASM_HASH || !COLLATERAL_ID || !PRICE_RESOLVER_ID)) {
  throw new Error("POOL_WASM_HASH, MARKET_WASM_HASH, COLLATERAL_ID, and the active price resolver are required");
}
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
  return {
    marketId,
    poolId,
    indexer: createIndexer({ rpcUrl: RPC_URL, poolId, stateFile: resolve(INDEXER_DIR, `${poolId}.json`) }),
    pending: [],
    seen: new Set(),
  };
}

function registerPool(marketId, poolId) {
  if (pools.has(poolId)) return pools.get(poolId);
  const p = newPool(marketId, poolId);
  pools.set(poolId, p);
  return p;
}

function savePools() {
  const list = [...pools.values()].map((p) => ({ marketId: p.marketId, poolId: p.poolId }));
  try {
    mkdirSync(dirname(POOLS_FILE), { recursive: true });
    writeFileSync(POOLS_FILE, JSON.stringify(list, null, 2));
  } catch {}
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

function pendingOrder(proof, publicSignals) {
  return {
    commitment: publicSignals[0],
    nullifierHash: publicSignals[1],
    cyes: { c1: ptOf(publicSignals, 2), c2: ptOf(publicSignals, 4) },
    cno: { c1: ptOf(publicSignals, 6), c2: ptOf(publicSignals, 8) },
    proof,
    publicSignals,
  };
}

function saveQueues() {
  const state = [...pools.values()].map((pool) => ({
    poolId: pool.poolId,
    seen: [...pool.seen],
    pending: pool.pending.map((order) => ({ proof: order.proof, publicSignals: order.publicSignals })),
  }));
  try {
    mkdirSync(dirname(QUEUE_FILE), { recursive: true });
    const tmp = `${QUEUE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, QUEUE_FILE);
  } catch {}
}

function loadQueues() {
  if (!existsSync(QUEUE_FILE)) return;
  try {
    for (const state of JSON.parse(readFileSync(QUEUE_FILE, "utf8"))) {
      const pool = pools.get(state.poolId);
      if (!pool || !Array.isArray(state.pending) || !Array.isArray(state.seen)) continue;
      pool.seen = new Set(state.seen.filter((value) => typeof value === "string" && DEC.test(value)));
      pool.pending = state.pending
        .filter((order) => order?.proof && Array.isArray(order.publicSignals) && order.publicSignals.length === 13)
        .map((order) => pendingOrder(order.proof, order.publicSignals));
    }
  } catch {}
}

function keeperStatus() {
  try {
    const value = JSON.parse(readFileSync(KEEPER_STATUS_FILE, "utf8"));
    const lastTick = Date.parse(value.lastTickAt || "");
    return {
      ...value,
      healthy: Number.isFinite(lastTick) && Date.now() - lastTick <= KEEPER_STALE_MS,
    };
  } catch {
    return { healthy: false, error: "keeper status unavailable" };
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
  if (!ALLOW_UNVERIFIED_REGISTRATION) {
    for (const pool of pools.values()) {
      try {
        await verifyPoolRegistration(pool.marketId, pool.poolId);
        await allowMemberTarget(pool.marketId, pool.poolId);
      } catch (error) {
        console.warn(`[server] skipped unapproved saved pool ${pool.poolId}: ${String(error.message || error)}`);
      }
    }
  }
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

async function readContract(contractId, method) {
  if (!READER_ADDRESS) throw new Error("READER_ADDRESS or FUNDER_SK is required for pool registration");
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(READER_ADDRESS);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method} failed: ${sim.error}`);
  return scValToNative(sim.result.retval);
}

async function verifyPoolRegistration(marketId, poolId) {
  if (ALLOW_UNVERIFIED_REGISTRATION) return;
  const [linkedMarket, poolCollateral, security, batcher, marketCollateral, marketResolver, marketInfo] = await Promise.all([
    readContract(poolId, "market"),
    readContract(poolId, "collateral"),
    readContract(poolId, "security_config"),
    readContract(marketId, "batcher"),
    readContract(marketId, "collateral"),
    readContract(marketId, "resolver"),
    readContract(marketId, "market_info"),
  ]);
  if (linkedMarket !== marketId || batcher !== poolId) {
    throw new Error("market and pool are not a linked Moros deployment");
  }
  if (poolCollateral !== marketCollateral || (COLLATERAL_ID && poolCollateral !== COLLATERAL_ID)) {
    throw new Error("market collateral does not match the configured asset");
  }
  if (marketResolver !== PRICE_RESOLVER_ID) {
    throw new Error("market does not use the active price resolver");
  }
  if (!RESOLVABLE_ASSETS.has(String(marketInfo.asset).toUpperCase())) {
    throw new Error("market asset is not supported by the active oracle mode");
  }
  const [committee, threshold, redeemConfigured] = security;
  const expectedMembers = Object.keys(memberAddrs).sort();
  const configuredMembers = [...committee].sort();
  if (!redeemConfigured || Number(threshold) !== THRESHOLD || JSON.stringify(configuredMembers) !== JSON.stringify(expectedMembers)) {
    throw new Error("pool security configuration does not match this committee");
  }
  const rpcServer = new rpc.Server(RPC_URL);
  const [poolWasm, marketWasm] = await Promise.all([
    rpcServer.getContractWasmByContractId(poolId),
    rpcServer.getContractWasmByContractId(marketId),
  ]);
  if (createHash("sha256").update(poolWasm).digest("hex") !== POOL_WASM_HASH) {
    throw new Error("pool WASM hash is not approved");
  }
  if (createHash("sha256").update(marketWasm).digest("hex") !== MARKET_WASM_HASH) {
    throw new Error("market WASM hash is not approved");
  }
}

async function allowMemberTarget(marketId, poolId) {
  if (ALLOW_UNVERIFIED_REGISTRATION) return;
  await Promise.all(Object.values(members).map(async (url) => {
    const response = await fetch(`${url}/allow-target`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(MEMBER_TOKEN ? { authorization: `Bearer ${MEMBER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ marketId, poolId }),
    });
    if (!response.ok) throw new Error(`${url}/allow-target -> ${response.status}: ${await response.text()}`);
  }));
}

const batching = new Set();
async function marketWindow(pool) {
  if (DRY && ALLOW_UNVERIFIED_REGISTRATION) {
    return { expiry: Math.floor(Date.now() / 1000) + 3600, finalizeAfter: Math.floor(Date.now() / 1000) + 3900 };
  }
  if (!FUNDER_SK || !pool.marketId) throw new Error("market reader is not configured");
  const server = new rpc.Server(RPC_URL);
  const source = Keypair.fromSecret(FUNDER_SK);
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(pool.marketId).call("market_info"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`market_info failed: ${sim.error}`);
  const info = scValToNative(sim.result.retval);
  return { expiry: Number(info.expiry), finalizeAfter: Number(info.finalize_after ?? info.expiry) };
}

async function batchPool(pool) {
  if (batching.has(pool.poolId)) return { skipped: "in progress" };
  if (!dkg) return { skipped: "committee not ready" };
  if (pool.pending.length === 0) return { skipped: "no pending orders" };
  let batchSize = Math.min(BATCH_N, pool.pending.length);
  let marketTimes;
  try {
    marketTimes = await marketWindow(pool);
  } catch (e) {
    return { skipped: String(e.message || e) };
  }
  const now = Math.floor(Date.now() / 1000);
  if (now >= marketTimes.finalizeAfter) {
    const expired = pool.pending.length;
    pool.pending = [];
    saveQueues();
    return { expired, note: "final batch deadline passed; on-chain pending orders are refundable" };
  }
  if (now < marketTimes.expiry && batchSize < BATCH_N) {
    return { skipped: `need ${BATCH_N}, have ${pool.pending.length}` };
  }
  if (now >= marketTimes.expiry && batchSize < 2) {
    return { skipped: "a private final batch needs at least 2 orders; the pending order becomes refundable after the deadline" };
  }
  batching.add(pool.poolId);
  try {
    const window = pool.pending.slice(0, batchSize);
    const netYes = addCiphers(window.map((o) => o.cyes));
    const netNo = addCiphers(window.map((o) => o.cno));
    const quorum = Object.fromEntries(Object.entries(members).slice(0, THRESHOLD));
    const yes = await collectPartials(quorum, dkg, netYes, MEMBER_TOKEN);
    const no = await collectPartials(quorum, dkg, netNo, MEMBER_TOKEN);
    if (yes.net === null || no.net === null) throw new Error("net decryption exceeded bound");
    console.log(`[server] pool ${pool.poolId} net: dqyes=${yes.net} dqno=${no.net}`);

    if (DRY || !pool.marketId || !FUNDER_SK) {
      pool.pending = pool.pending.slice(batchSize);
      saveQueues();
      return { dryRun: true, dqyes: yes.net.toString(), dqno: no.net.toString() };
    }
    const attestPayload = {
      cipherYes: cipherJson(netYes),
      cipherNo: cipherJson(netNo),
      partialsYes: yes.partials,
      partialsNo: no.partials,
      dqyes: yes.net.toString(),
      dqno: no.net.toString(),
      orders: window.map((order) => ({ proof: order.proof, publicSignals: order.publicSignals })),
    };
    const nullHashes = window.map((o) => BigInt(o.nullifierHash).toString(16).padStart(64, "0"));
    const commitments = window.map((o) => BigInt(o.commitment).toString(16).padStart(64, "0"));
    attestPayload.nullHashes = nullHashes;
    attestPayload.commitments = commitments;
    const out = await submitPoolBatch({
      pool: pool.poolId,
      dqyesFp: (yes.net * S).toString(),
      dqnoFp: (no.net * S).toString(),
      nullHashes,
      commitments,
      signerAddrs: Object.keys(memberAddrs).slice(0, THRESHOLD),
      sourceSk: FUNDER_SK,
      attest: async ({ address, entryXdr, validUntilLedger }) => {
        const url = memberAddrs[address];
        if (!url) throw new Error(`no member service for signer ${address}`);
        const r = await attestEntry(url, { entryXdr, validUntilLedger, ...attestPayload }, MEMBER_TOKEN);
        return r.signedEntryXdr;
      },
    });
    pool.pending = pool.pending.slice(batchSize);
    saveQueues();
    console.log(`[server] pool ${pool.poolId} batch on-chain: tx ${out.hash}`);
    return { batched: batchSize, tx: out.hash, net: out.net.toString() };
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
    if (r.batched || r.dryRun || r.error || r.expired) out[pool.poolId] = r;
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

const CORS = {
  "access-control-allow-origin": process.env.CORS_ORIGIN || "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  try {
    if (req.method === "GET" && req.url === "/health") {
      const keeper = keeperStatus();
      const healthy = !!dkg && keeper.healthy;
      return send(healthy ? 200 : 503, { healthy, committeeReady: !!dkg, keeper });
    }
    if (req.method === "GET" && req.url === "/status") {
      return send(200, {
        committee: { members: MEMBERS.length, threshold: THRESHOLD, ready: !!dkg },
        oracle: { mode: ORACLE_MODE, resolver: PRICE_RESOLVER_ID, assets: [...RESOLVABLE_ASSETS] },
        keeper: keeperStatus(),
        batchN: BATCH_N, windowMs: WINDOW_MS,
        pools: [...pools.values()].map((p) => ({ market: p.marketId, pool: p.poolId, pending: p.pending.length })),
      });
    }
    if (req.method === "GET" && req.url === "/pk") {
      if (!pkDec) return send(503, { error: "committee not ready" });
      return send(200, { pk: pkDec, note: "encrypt orders to this epoch key; prove with encrypt_order.circom" });
    }
    if (req.method === "GET" && req.url.startsWith("/proof/")) {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const commitment = requestUrl.pathname.slice("/proof/".length);
      const requestedPoolId = requestUrl.searchParams.get("poolId");
      if (!DEC.test(commitment) || (requestedPoolId && !CID.test(requestedPoolId))) {
        return send(400, { error: "invalid commitment or pool ID" });
      }
      const selectedPool = requestedPoolId ? pools.get(requestedPoolId) : null;
      if (requestedPoolId && !selectedPool) return send(404, { error: "pool not registered" });
      const candidates = selectedPool ? [selectedPool] : pools.values();
      for (const pool of candidates) {
        await pool.indexer.poll().catch(() => {});
        const p = pool.indexer.proofFor(commitment);
        if (p) return send(200, { ...p, poolId: pool.poolId });
      }
      return send(404, { error: "commitment not indexed yet" });
    }
    if (req.method !== "POST") return send(404, { error: "not found" });

    if (req.url === "/register-pool") {
      const o = await readBody(req);
      if (!CID.test(o.marketId || "") || !CID.test(o.poolId || "")) return send(400, { error: "need valid marketId and poolId" });
      if (!pools.has(o.poolId) && pools.size >= MAX_POOLS) return send(429, { error: "pool registry full" });
      await verifyPoolRegistration(o.marketId, o.poolId);
      await allowMemberTarget(o.marketId, o.poolId);
      const p = registerPool(o.marketId, o.poolId);
      savePools();
      saveQueues();
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
      pool.pending.push(pendingOrder(o.proof, o.publicSignals));
      saveQueues();
      return send(200, { queued: true, pending: pool.pending.length, note: "server holds ciphertexts only" });
    }
    if (req.url === "/batch") {
      if (!authed(req)) return send(401, { error: "unauthorized" });
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
      if (o.poolId && !pools.has(o.poolId)) return send(404, { error: "pool not registered" });
      const poolId = o.poolId || cfg.poolId;
      const redeemDir = mkdtempSync(resolve(cfg.work, "redeem-"));
      const pf = resolve(redeemDir, "proof.json");
      const pu = resolve(redeemDir, "public.json");
      try {
        writeFileSync(pf, JSON.stringify(o.proof));
        writeFileSync(pu, JSON.stringify(o.public));
        return send(200, relay(pf, pu, o.recipient, { poolId }));
      } finally {
        rmSync(redeemDir, { recursive: true, force: true });
      }
    }
    return send(404, { error: "not found" });
  } catch (e) {
    return send(400, { error: String(e.message || e) });
  }
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

loadPools();
loadQueues();
for (const pool of pools.values()) await pool.indexer.poll().catch(() => {});
await bootstrap();
server.listen(PORT, () =>
  console.log(`[server] no-leak multi-pool committee on :${PORT} (batchN=${BATCH_N}, window=${WINDOW_MS}ms, pools=${pools.size}, auth=${TOKEN ? "on" : "OFF"})`)
);
