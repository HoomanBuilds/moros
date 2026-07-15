import {
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

const RPC = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const RESOLVER = process.env.RESOLVER_ID || "CBBS7NE75FTFO7TPTKGC5MLTZXQAU75MX3BEGVWI4GIIB6W3V4OXRDR4";
const FUNDER_SK = process.env.FUNDER_SK || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khufxpfbigxpuvsvlhtn.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "";
const INTERVAL_MS = Number(process.env.RESOLVE_INTERVAL_MS || 300000);
const RESOLVABLE = new Set(["XLM", "BTC", "ETH", "SOL", "XRP", "ADA", "AVAX", "LINK", "DOT"]);

const server = new rpc.Server(RPC);
const funder = Keypair.fromSecret(FUNDER_SK);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readContract(id, method) {
  const acc = await server.getAccount(funder.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(id).call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

async function resolveMarket(market) {
  const acc = await server.getAccount(funder.publicKey());
  const arg = nativeToScVal(Address.fromString(market), { type: "address" });
  const tx = new TransactionBuilder(acc, {
    fee: (Number(BASE_FEE) * 10000).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(RESOLVER).call("resolve_market", arg))
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

async function marketIds() {
  if (process.env.MARKETS) return process.env.MARKETS.split(",").map((s) => s.trim()).filter(Boolean);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/markets_meta?pool_id=not.is.null&select=market_id`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!res.ok) return [];
  return (await res.json()).map((r) => r.market_id).filter(Boolean);
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
      if (now < Number(info.expiry)) continue;
      console.log(`[keeper] ${id} (${asset}) expired + open -> resolving`);
      const res = await resolveMarket(id);
      console.log(`[keeper] ${id} settled -> ${JSON.stringify(res)}`);
    } catch (e) {
      console.log(`[keeper] ${id}: ${e.message}`);
    }
  }
}

async function main() {
  console.log(`[keeper] resolve-keeper up: interval=${INTERVAL_MS}ms resolver=${RESOLVER} funder=${funder.publicKey()}`);
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
