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
import { PythLazerClient } from "@pythnetwork/pyth-lazer-sdk";

const RPC = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const ORACLE_MODE = process.env.ORACLE_MODE || "free";
const FREE_RESOLVER = process.env.FREE_RESOLVER_ID || "CCLZEQIQLPJVFDQCAMFC3A3S6HIRQ2ZIAICC2NH3D3U4ZCCXZI2RU6TQ";
const PYTH_PRO_RESOLVER = process.env.PYTH_PRO_RESOLVER_ID || "";
const RESOLVER = ORACLE_MODE === "pyth_pro" ? PYTH_PRO_RESOLVER : FREE_RESOLVER;
const FUNDER_SK = process.env.FUNDER_SK || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khufxpfbigxpuvsvlhtn.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "";
const INTERVAL_MS = Number(process.env.RESOLVE_INTERVAL_MS || 300000);
const PYTH_TOKEN = process.env.PYTH_ACCESS_TOKEN || "";
const RESOLVABLE = new Set(["XLM", "BTC", "ETH", "SOL", "XRP", "ADA", "AVAX", "LINK", "DOT"]);
const PYTH_FEEDS = { BTC: 1, ETH: 2, SOL: 6, XRP: 14, ADA: 16, AVAX: 18, LINK: 19, DOT: 22, XLM: 23 };

const server = new rpc.Server(RPC);
const funder = FUNDER_SK ? Keypair.fromSecret(FUNDER_SK) : null;
let pythClient;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (ORACLE_MODE !== "pyth_pro" || !PYTH_TOKEN || !PYTH_FEEDS[asset]) return null;
  pythClient ??= await PythLazerClient.create({ token: PYTH_TOKEN });
  const update = await pythClient.getPrice({
    timestamp: expiry * 1_000_000,
    priceFeedIds: [PYTH_FEEDS[asset]],
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

async function marketIds() {
  if (process.env.MARKETS) return process.env.MARKETS.split(",").map((s) => s.trim()).filter(Boolean);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/markets_meta?pool_id=not.is.null&select=market_id,resolver_type`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (res.ok) {
    return (await res.json()).filter((r) => !r.resolver_type || r.resolver_type === "price").map((r) => r.market_id).filter(Boolean);
  }
  const fallback = await fetch(`${SUPABASE_URL}/rest/v1/markets_meta?pool_id=not.is.null&select=market_id`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!fallback.ok) return [];
  return (await fallback.json()).map((r) => r.market_id).filter(Boolean);
}

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const ids = await marketIds();
  for (const id of ids) {
    try {
      const outcome = await readContract(id, "outcome");
      if (outcome != null) continue;
      const info = await readContract(id, "market_info");
      const asset = String(info.asset || "").toUpperCase();
      if (!RESOLVABLE.has(asset)) continue;
      if (now < Number(info.finalize_after ?? info.expiry)) continue;
      const configuredResolver = await readContract(id, "resolver");
      if (configuredResolver !== RESOLVER) continue;
      console.log(`[keeper] ${id} (${asset}) expired + open -> resolving`);
      const payload = await pythPayload(asset, Number(info.expiry)).catch((error) => {
        console.log(`[keeper] ${id}: Pyth payload unavailable: ${error.message}`);
        return null;
      });
      try {
        const res = await resolveMarket(id, payload);
        console.log(`[keeper] ${id} settled -> ${JSON.stringify(res)}`);
      } catch (resolveError) {
        console.log(`[keeper] ${id}: resolution unavailable: ${resolveError.message}`);
        await voidStaleMarket(id);
        console.log(`[keeper] ${id}: oracle timeout reached, market voided`);
      }
    } catch (e) {
      console.log(`[keeper] ${id}: ${e.message}`);
    }
  }
}

async function main() {
  if (!funder) throw new Error("FUNDER_SK is required");
  if (!new Set(["free", "pyth_pro"]).has(ORACLE_MODE)) throw new Error("ORACLE_MODE must be free or pyth_pro");
  if (!RESOLVER) throw new Error(`Resolver is not configured for ${ORACLE_MODE} mode`);
  if (ORACLE_MODE === "pyth_pro" && !PYTH_TOKEN) throw new Error("PYTH_ACCESS_TOKEN is required in pyth_pro mode");
  console.log(`[keeper] resolve-keeper up: interval=${INTERVAL_MS}ms resolver=${RESOLVER} mode=${ORACLE_MODE} funder=${funder.publicKey()}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.log(`[keeper] tick error: ${e.message}`);
    }
    await sleep(INTERVAL_MS);
  }
}

main();
