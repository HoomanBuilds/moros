import "../config.mjs";
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { Address, xdr } from "@stellar/stellar-sdk";
import { addCiphers } from "./jubjub.mjs";
import { runDKG, collectPartials, attestEntry } from "./coordinator.mjs";
import { submitPoolBatch } from "./submit-multisig.mjs";
import { relay } from "../relayer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const FORK = resolve(REPO, "inspiration/zk/soroban-privacy-pools");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const C2S = resolve(FORK, "target/release/stellar-circom2soroban");
const ORDER_TREE = resolve(FORK, "target/release/order_tree");
const MARKET_WASM = resolve(REPO, "contracts/target/wasm32v1-none/release/lmsr_market.optimized.wasm");
const POOL_WASM = resolve(REPO, "contracts/shielded-pool/target/wasm32v1-none/release/privacy_pools.wasm");
const NET = "testnet";
const S = 1n << 32n;
const DEC = 10_000_000n;
const TOKEN = "e2e-mp-token";

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}
function invoke(id, fn, args) {
  return sh("stellar", ["contract", "invoke", "--id", id, "--source", "deployer", "--network", NET, "--", fn, ...args]).trim().split("\n").pop();
}
function keyAddr(n) { return sh("stellar", ["keys", "address", n]).trim(); }
function keySecret(n) { return sh("stellar", ["keys", "show", n]).trim(); }
function hexFrom(kind, p) { return sh(C2S, [kind, p]).split("\n").filter((l) => /^[0-9a-f]{40,}$/.test(l.trim())).pop().trim(); }
function decToHex32(dec) { return BigInt(dec).toString(16).padStart(64, "0"); }
function recipientField(g) {
  const scv = xdr.ScVal.scvAddress(new Address(g).toScAddress());
  const h = createHash("sha256").update(scv.toXDR()).digest();
  h[0] &= 0x1f;
  return BigInt("0x" + h.toString("hex")).toString();
}
function jubRand() {
  const b = createHash("sha256").update(`r-${Math.random()}-${process.hrtime.bigint()}`).digest("hex");
  return (BigInt("0x" + b) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n).toString();
}

const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const DEPLOYER = keyAddr("deployer");
const BOB = keyAddr("bob");
const COMM = [keyAddr("comm1"), keyAddr("comm2"), keyAddr("comm3")];
const MAIN_VK = hexFrom("vk", resolve(CIRC, "output/main_verification_key.json"));
const DEPOSIT_VK = hexFrom("vk", resolve(CIRC, "output/deposit_vk.json"));
const REDEEM_VK = hexFrom("vk", resolve(CIRC, "build/order_redeem_v2_vk.json"));
const EXPIRY = "2000000000";

function deployShielded(asset, threshold) {
  const market = sh("stellar", ["contract", "deploy", "--wasm", MARKET_WASM, "--source", "deployer", "--network", NET, "--",
    "--admin", DEPLOYER, "--collateral", XLM, "--b", (100n * S).toString(), "--asset", asset, "--threshold", threshold, "--expiry", EXPIRY]).trim().split("\n").pop();
  const pool = sh("stellar", ["contract", "deploy", "--wasm", POOL_WASM, "--source", "deployer", "--network", NET, "--",
    "--vk_bytes", MAIN_VK, "--deposit_vk_bytes", DEPOSIT_VK, "--token_address", XLM, "--admin", DEPLOYER, "--market", market, "--cap", "100000000000"]).trim().split("\n").pop();
  invoke(market, "set_batcher", ["--admin", DEPLOYER, "--batcher", pool]);
  invoke(pool, "set_committee", ["--caller", DEPLOYER, "--members", JSON.stringify(COMM), "--threshold", "2"]);
  invoke(pool, "set_redeem_v2_vk", ["--caller", DEPLOYER, "--vk_bytes", REDEEM_VK]);
  return { asset, market, pool };
}

const work = mkdtempSync(resolve(tmpdir(), "e2e-mp-"));
const record = { network: NET, pools: {} };
const memberUrls = { 1: "http://127.0.0.1:39751", 2: "http://127.0.0.1:39752", 3: "http://127.0.0.1:39753" };
let procs = [];

async function processPool(mp, orders, dkg, pkDec, label, doRedeem) {
  console.log(`[${label}] tree + place ${orders.length} orders`);
  const ordersPath = resolve(work, `orders-${label}.json`);
  writeFileSync(ordersPath, JSON.stringify(orders));
  const tree = JSON.parse(sh(ORDER_TREE, [ordersPath, "16"]));
  for (const [k, o] of orders.entries()) {
    invoke(mp.pool, "place_order", ["--from", DEPLOYER, "--commitment", decToHex32(tree.orders[k].commitment), "--stake", (BigInt(o.amount) * DEC).toString()]);
  }
  const rootOnChain = invoke(mp.pool, "get_order_root", []).replace(/"/g, "");
  if (BigInt("0x" + rootOnChain) !== BigInt(tree.orderRoot)) throw new Error(`${label}: order root mismatch`);

  console.log(`[${label}] prove encrypt_order for each`);
  const cyes = [], cno = [];
  for (const [k, o] of orders.entries()) {
    const leaf = tree.orders[k];
    const inp = { orderRoot: tree.orderRoot, amount: o.amount, side: o.side, secret: o.secret, nullifier: o.nullifier,
      ryes: jubRand(), rno: jubRand(), pk: pkDec, pathIndex: leaf.pathIndex, siblings: leaf.siblings };
    writeFileSync(resolve(work, `e-${label}-${k}.json`), JSON.stringify(inp));
    sh("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), resolve(work, `e-${label}-${k}.json`), resolve(work, `ew-${label}-${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), resolve(work, `ew-${label}-${k}.wtns`), resolve(work, `ep-${label}-${k}.json`), resolve(work, `epub-${label}-${k}.json`)]);
    const pub = JSON.parse(readFileSync(resolve(work, `epub-${label}-${k}.json`), "utf8"));
    if (pub[10] !== tree.orderRoot) throw new Error(`${label} order ${k}: proof root mismatch`);
    cyes.push({ c1: [BigInt(pub[2]), BigInt(pub[3])], c2: [BigInt(pub[4]), BigInt(pub[5])] });
    cno.push({ c1: [BigInt(pub[6]), BigInt(pub[7])], c2: [BigInt(pub[8]), BigInt(pub[9])] });
  }

  console.log(`[${label}] committee decrypts ONLY the net`);
  const netYes = addCiphers(cyes), netNo = addCiphers(cno);
  const quorum = { 1: memberUrls[1], 3: memberUrls[3] };
  const yes = await collectPartials(quorum, dkg, netYes, TOKEN);
  const no = await collectPartials(quorum, dkg, netNo, TOKEN);
  const expYes = orders.filter((o) => o.side === "1").reduce((a, o) => a + BigInt(o.amount), 0n);
  const expNo = orders.filter((o) => o.side === "0").reduce((a, o) => a + BigInt(o.amount), 0n);
  console.log(`[${label}] net dqyes=${yes.net} dqno=${no.net} (expect ${expYes}, ${expNo})`);
  if (yes.net !== expYes || no.net !== expNo) throw new Error(`${label}: net LEAK - isolation broken`);

  console.log(`[${label}] submit_batch to its own pool/market`);
  const cj = (c) => ({ c1: [c.c1[0].toString(), c.c1[1].toString()], c2: [c.c2[0].toString(), c.c2[1].toString()] });
  const payload = { cipherYes: cj(netYes), cipherNo: cj(netNo), partialsYes: yes.partials, partialsNo: no.partials, dqyes: yes.net.toString(), dqno: no.net.toString() };
  const addrToUrl = {};
  for (const url of Object.values(quorum)) { const h = await (await fetch(`${url}/health`)).json(); addrToUrl[h.address] = url; }
  const nullHashes = orders.map((_, k) => decToHex32(tree.orders[k].nullifierHash));
  const batch = await submitPoolBatch({
    pool: mp.pool, dqyesFp: (yes.net * S).toString(), dqnoFp: (no.net * S).toString(), nullHashes,
    signerAddrs: Object.keys(addrToUrl), sourceSk: process.env.FUNDER_SK,
    attest: async ({ address, entryXdr, validUntilLedger }) => (await attestEntry(addrToUrl[address], { entryXdr, validUntilLedger, ...payload }, TOKEN)).signedEntryXdr,
  });
  const price = invoke(mp.pool, "get_price", []).replace(/"/g, "");
  console.log(`[${label}] batched tx ${batch.hash}; priceYes ${price}`);

  if (!doRedeem) {
    return { market: mp.market, pool: mp.pool, netYes: yes.net.toString(), netNo: no.net.toString(), price, batchTx: batch.hash, redeemGainXlm: null };
  }

  console.log(`[${label}] resolve Yes, claim, private redeem winner -> bob`);
  invoke(mp.market, "fund", ["--from", DEPLOYER, "--amount", "1000000000"]);
  invoke(mp.market, "resolve", ["--admin", DEPLOYER, "--outcome", '"Yes"']);
  invoke(mp.pool, "claim_winnings", []);
  const win = orders.findIndex((o) => o.side === "1");
  const leaf = tree.orders[win], o = orders[win];
  const rin = { orderRoot: tree.orderRoot, recipient: recipientField(BOB), winningOutcome: "1", priceYes: price, fee: "1000000",
    amount: o.amount, side: o.side, secret: o.secret, nullifier: o.nullifier, pathIndex: leaf.pathIndex, siblings: leaf.siblings };
  writeFileSync(resolve(work, `r-${label}.json`), JSON.stringify(rin));
  sh("node", [resolve(CIRC, "build/order_redeem_v2_js/generate_witness.js"), resolve(CIRC, "build/order_redeem_v2_js/order_redeem_v2.wasm"), resolve(work, `r-${label}.json`), resolve(work, `rw-${label}.wtns`)]);
  sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "output/order_redeem_v2_final.zkey"), resolve(work, `rw-${label}.wtns`), resolve(work, `rp-${label}.json`), resolve(work, `rpub-${label}.json`)]);
  const before = BigInt(invoke(XLM, "balance", ["--id", BOB]).replace(/"/g, ""));
  relay(resolve(work, `rp-${label}.json`), resolve(work, `rpub-${label}.json`), BOB, { poolId: mp.pool, source: "deployer" });
  const after = BigInt(invoke(XLM, "balance", ["--id", BOB]).replace(/"/g, ""));
  const gain = Number(after - before) / 1e7;
  console.log(`[${label}] winner redeem paid bob +${gain} XLM`);
  if (after - before <= 0n) throw new Error(`${label}: redeem paid nothing`);
  return { market: mp.market, pool: mp.pool, netYes: yes.net.toString(), netNo: no.net.toString(), price, batchTx: batch.hash, redeemGainXlm: gain };
}

try {
  console.log("[1] deploy TWO shielded markets sharing one committee");
  const A = deployShielded("XLM", "25000000000000");
  const B = deployShielded("BTC", "6500000000000000000");
  console.log("    A:", A.market, A.pool, "\n    B:", B.market, B.pool);

  console.log("[2] start 3 members allowed to attest for BOTH pools");
  procs = Object.entries(memberUrls).map(([i, url]) =>
    spawn("node", [resolve(HERE, "member.mjs")], {
      env: { ...process.env, PORT: new URL(url).port, INDEX: i, MEMBER_TOKEN: TOKEN,
        ATTEST_TARGETS: `${A.pool},${B.pool}`, ATTEST_METHOD: "submit_batch_committee", ATTEST_DQ_OFFSET: "1",
        MEMBER_SK: keySecret(`comm${i}`) },
      stdio: ["ignore", "inherit", "inherit"],
    }));
  for (let k = 0; ; k++) {
    try { for (const u of Object.values(memberUrls)) if (!(await fetch(`${u}/health`)).ok) throw 0; break; }
    catch { if (k > 100) throw new Error("members not healthy"); await new Promise((r) => setTimeout(r, 200)); }
  }
  const dkg = await runDKG(memberUrls, 2, TOKEN);
  const pkDec = [dkg.pk[0].toString(), dkg.pk[1].toString()];
  console.log("    committee joint pk agreed (shared across both pools)");

  console.log("[3] pool A full lifecycle (net 30/20, redeem) + pool B independent batch (net 8/3)");
  const resA = await processPool(A, [
    { amount: "10", side: "1", secret: "201", nullifier: "202" },
    { amount: "20", side: "1", secret: "203", nullifier: "204" },
    { amount: "5", side: "0", secret: "205", nullifier: "206" },
    { amount: "15", side: "0", secret: "207", nullifier: "208" },
  ], dkg, pkDec, "A", true);
  const resB = await processPool(B, [
    { amount: "8", side: "1", secret: "301", nullifier: "302" },
    { amount: "3", side: "0", secret: "303", nullifier: "304" },
  ], dkg, pkDec, "B", false);

  if (resA.netYes !== "30" || resA.netNo !== "20") throw new Error("pool A net wrong - ISOLATION FAILED");
  if (resB.netYes !== "8" || resB.netNo !== "3") throw new Error("pool B net wrong - ISOLATION FAILED");
  if (!(resA.redeemGainXlm > 0)) throw new Error("pool A redeem paid nothing");
  record.pools = { A: resA, B: resB };
  record.description = "Multi-pool committee proven live: two independent shielded markets (XLM, BTC) share one t-of-n committee. Pool A's full private lifecycle (batch net 30/20 -> resolve -> private redeem pays a winner) and pool B's independent batch (net 8/3) each settle ONLY their own orders to their OWN market with no cross-leak. Members attest for both pools via ATTEST_TARGETS.";
  writeFileSync(resolve(REPO, "deployments/multipool-testnet.json"), JSON.stringify(record, null, 2) + "\n");
  console.log("PASS: multi-pool settlement + private redeem proven live. Record -> deployments/multipool-testnet.json");
} catch (e) {
  console.error("FAIL:", e.message || e);
  process.exitCode = 1;
} finally {
  for (const p of procs) p.kill();
  rmSync(work, { recursive: true, force: true });
}
