import {
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { PythLazerClient } from "@pythnetwork/pyth-lazer-sdk";
import {
  PYTH_PRO_FEEDS,
  resolvableAssets,
  resolutionPhase,
  selectFreeResolver,
} from "./oracle-config.mjs";
import { contractResultValue } from "./deployment-utils.mjs";

const RPC = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const ORACLE_MODE = process.env.ORACLE_MODE || "free";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PRIVATE_DEPLOYMENT_PATH = resolve(
  REPO_ROOT,
  process.env.MOROS_PUBLIC_DEPLOYMENT ||
    "deployments/private-testnet.json",
);
const PRIVATE_DEPLOYMENT = existsSync(PRIVATE_DEPLOYMENT_PATH)
  ? JSON.parse(readFileSync(PRIVATE_DEPLOYMENT_PATH, "utf8"))
  : undefined;
const FREE_RESOLVER = selectFreeResolver(PRIVATE_DEPLOYMENT);
const PYTH_PRO_RESOLVER = process.env.PYTH_PRO_RESOLVER_ID || "";
const RESOLVER = ORACLE_MODE === "pyth_pro" ? PYTH_PRO_RESOLVER : FREE_RESOLVER;
const FUNDER_SK = process.env.FUNDER_SK || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khufxpfbigxpuvsvlhtn.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "";
const COLLATERAL_ID = PRIVATE_DEPLOYMENT?.collateral?.contract;
if (!/^C[A-Z2-7]{55}$/.test(COLLATERAL_ID || "")) {
  throw new Error("deployment collateral contract ID is invalid");
}
const INTERVAL_MS = Number(process.env.RESOLVE_INTERVAL_MS || 300000);
const TTL_REFRESH_MS = Number(process.env.TTL_REFRESH_MS || 604800000);
const PYTH_TOKEN = process.env.PYTH_ACCESS_TOKEN || "";
const RESOLVABLE = resolvableAssets(ORACLE_MODE);
const STATUS_FILE = process.env.KEEPER_STATUS_FILE || fileURLToPath(new URL("./keeper-status.json", import.meta.url));

const server = new rpc.Server(RPC);
const funder = FUNDER_SK ? Keypair.fromSecret(FUNDER_SK) : null;
let pythClient;
let resolutionTimeout = 0;
const lastTtlRefresh = new Map();
let status = {
  startedAt: new Date().toISOString(),
  lastTickAt: null,
  mode: ORACLE_MODE,
  resolver: RESOLVER,
  marketsScanned: 0,
  dueMarkets: 0,
  resolvedMarkets: 0,
  voidedMarkets: 0,
  waitingForOracle: 0,
  ttlRefreshed: 0,
  errors: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saveStatus(update = {}) {
  status = { ...status, ...update };
  const temp = `${STATUS_FILE}.tmp`;
  mkdirSync(dirname(STATUS_FILE), { recursive: true });
  writeFileSync(temp, JSON.stringify(status, null, 2), { mode: 0o600 });
  renameSync(temp, STATUS_FILE);
}

async function readContract(id, method) {
  if (!funder) throw new Error("FUNDER_SK is required");
  const acc = await server.getAccount(funder.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(id).call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

async function pythPayload(asset, expiry) {
  if (ORACLE_MODE !== "pyth_pro" || !PYTH_TOKEN || !PYTH_PRO_FEEDS[asset]) return null;
  pythClient ??= await PythLazerClient.create({ token: PYTH_TOKEN });
  const update = await pythClient.getPrice({
    timestamp: expiry * 1_000_000,
    priceFeedIds: [PYTH_PRO_FEEDS[asset]],
    properties: ["price", "exponent", "confidence", "feedUpdateTimestamp"],
    formats: ["leEcdsa"],
    jsonBinaryEncoding: "hex",
    parsed: true,
    channel: "fixed_rate@200ms",
  });
  return update.leEcdsa?.data || null;
}

async function resolveMarket(market, payloadHex) {
  if (!funder) throw new Error("FUNDER_SK is required");
  const acc = await server.getAccount(funder.publicKey());
  const arg = nativeToScVal(Address.fromString(market), { type: "address" });
  const tx = new TransactionBuilder(acc, {
    fee: (Number(BASE_FEE) * 10000).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(RESOLVER).call(
      "resolve_market",
      arg,
      payloadHex ? xdr.ScVal.scvBytes(Buffer.from(payloadHex, "hex")) : xdr.ScVal.scvVoid(),
    ))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(funder);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error("send rejected");
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const g = await server.getTransaction(sent.hash);
    if (g.status === "SUCCESS") return scValToNative(g.returnValue);
    if (g.status === "FAILED") throw new Error("tx failed on-chain");
  }
  throw new Error("tx timed out");
}

async function voidStaleMarket(market) {
  if (!funder) throw new Error("FUNDER_SK is required");
  const acc = await server.getAccount(funder.publicKey());
  const tx = new TransactionBuilder(acc, {
    fee: (Number(BASE_FEE) * 10000).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(RESOLVER).call(
      "void_stale_market",
      nativeToScVal(Address.fromString(market), { type: "address" }),
    ))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(funder);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error("stale-market void rejected");
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return;
    if (result.status === "FAILED") throw new Error("stale-market void failed on-chain");
  }
  throw new Error("stale-market void timed out");
}

async function touchContract(contractId) {
  if (!funder) throw new Error("FUNDER_SK is required");
  const account = await server.getAccount(funder.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 10000).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call("extend_ttl"))
    .setTimeout(60)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) throw new Error(simulation.error);
  const prepared = rpc.assembleTransaction(tx, simulation).build();
  prepared.sign(funder);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error("TTL refresh rejected");
  for (let index = 0; index < 30; index++) {
    await sleep(2000);
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return;
    if (result.status === "FAILED") throw new Error("TTL refresh failed on-chain");
  }
  throw new Error("TTL refresh timed out");
}

async function refreshTargetTtl(target, nowMs) {
  const ids = [target.marketId, target.poolId].filter(Boolean);
  let refreshed = 0;
  for (const contractId of ids) {
    if (nowMs - (lastTtlRefresh.get(contractId) || 0) < TTL_REFRESH_MS) continue;
    await touchContract(contractId);
    lastTtlRefresh.set(contractId, nowMs);
    refreshed++;
  }
  return refreshed;
}

async function marketTargets() {
  const configuredMarkets = (process.env.MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const configuredPools = (process.env.POOLS || "").split(",").map((value) => value.trim());
  const configured = configuredMarkets.map((marketId, index) => ({ marketId, poolId: configuredPools[index] || null }));
  let discovered = [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/markets_meta?pool_id=not.is.null&select=market_id,pool_id,resolver_type,collateral_sac`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (res.ok) {
    discovered = (await res.json())
      .filter((row) => (!row.resolver_type || row.resolver_type === "price") && row.collateral_sac === COLLATERAL_ID)
      .map((row) => ({ marketId: row.market_id, poolId: row.pool_id }))
      .filter((row) => row.marketId);
  } else {
    const fallback = await fetch(`${SUPABASE_URL}/rest/v1/markets_meta?pool_id=not.is.null&select=market_id,pool_id`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (fallback.ok) {
      discovered = (await fallback.json())
        .map((row) => ({ marketId: row.market_id, poolId: row.pool_id }))
        .filter((row) => row.marketId);
    }
  }
  return [...new Map([...configured, ...discovered].map((target) => [target.marketId, target])).values()];
}

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const targets = await marketTargets();
  const report = {
    lastTickAt: new Date().toISOString(),
    marketsScanned: targets.length,
    dueMarkets: 0,
    resolvedMarkets: 0,
    voidedMarkets: 0,
    waitingForOracle: 0,
    ttlRefreshed: 0,
    errors: [],
  };
  for (const target of targets) {
    const id = target.marketId;
    try {
      try {
        report.ttlRefreshed += await refreshTargetTtl(target, Date.now());
      } catch (ttlError) {
        report.errors.push({ market: id, message: `TTL refresh: ${ttlError.message}` });
      }
      const outcome = await readContract(id, "outcome");
      if (outcome != null) continue;
      const info = await readContract(id, "market_info");
      const asset = String(info.asset || "").toUpperCase();
      if (!RESOLVABLE.has(asset)) continue;
      const phase = resolutionPhase(
        now,
        Number(info.expiry),
        Number(info.finalize_after ?? info.expiry),
        resolutionTimeout,
      );
      if (phase === "open" || phase === "final_batch") continue;
      const configuredResolver = await readContract(id, "resolver");
      if (configuredResolver !== RESOLVER) continue;
      report.dueMarkets++;
      console.log(`[keeper] ${id} (${asset}) expired + open -> resolving`);
      const payload = await pythPayload(asset, Number(info.expiry)).catch((error) => {
        console.log(`[keeper] ${id}: Pyth payload unavailable: ${error.message}`);
        return null;
      });
      try {
        const res = await resolveMarket(id, payload);
        console.log(`[keeper] ${id} settled -> ${JSON.stringify(res)}`);
        const finalOutcome = await readContract(id, "outcome");
        if (String(finalOutcome).toLowerCase().includes("void")) report.voidedMarkets++;
        else report.resolvedMarkets++;
      } catch (resolveError) {
        console.log(`[keeper] ${id}: resolution unavailable: ${resolveError.message}`);
        if (phase === "void") {
          await voidStaleMarket(id);
          report.voidedMarkets++;
          console.log(`[keeper] ${id}: oracle timeout reached, market voided`);
        } else {
          report.waitingForOracle++;
        }
      }
    } catch (e) {
      console.log(`[keeper] ${id}: ${e.message}`);
      report.errors.push({ market: id, message: e.message });
    }
  }
  saveStatus({ ...report, errors: report.errors.slice(-20) });
}

async function main() {
  if (!funder) throw new Error("FUNDER_SK is required");
  if (!new Set(["free", "pyth_pro"]).has(ORACLE_MODE)) throw new Error("ORACLE_MODE must be free or pyth_pro");
  if (!RESOLVER) throw new Error(`Resolver is not configured for ${ORACLE_MODE} mode`);
  if (ORACLE_MODE === "pyth_pro" && !PYTH_TOKEN) throw new Error("PYTH_ACCESS_TOKEN is required in pyth_pro mode");
  const config = contractResultValue(await readContract(RESOLVER, "config"));
  resolutionTimeout = Number(config.resolution_timeout);
  if (!Number.isSafeInteger(resolutionTimeout) || resolutionTimeout < 300) {
    throw new Error("Resolver returned an invalid resolution timeout");
  }
  saveStatus({ resolutionTimeout });
  console.log(`[keeper] resolve-keeper up: interval=${INTERVAL_MS}ms resolver=${RESOLVER} mode=${ORACLE_MODE} funder=${funder.publicKey()}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.log(`[keeper] tick error: ${e.message}`);
      saveStatus({
        lastTickAt: new Date().toISOString(),
        errors: [{ market: null, message: e.message }],
      });
    }
    await sleep(INTERVAL_MS);
  }
}

main();
