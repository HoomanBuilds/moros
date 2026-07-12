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
const NET = "testnet";
const S = 1n << 32n;
const DEC = 10_000_000n;

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}
function invoke(id, source, fn, args) {
  return sh("stellar", ["contract", "invoke", "--id", id, "--source", source, "--network", NET, "--", fn, ...args]).trim().split("\n").pop();
}
function keyAddr(n) { return sh("stellar", ["keys", "address", n]).trim(); }
function hexFrom(kind, p) {
  return sh(C2S, [kind, p]).split("\n").filter((l) => /^[0-9a-f]{40,}$/.test(l.trim())).pop().trim();
}
function decToHex32(dec) { return BigInt(dec).toString(16).padStart(64, "0"); }
function recipientField(g) {
  const scv = xdr.ScVal.scvAddress(new Address(g).toScAddress());
  const h = createHash("sha256").update(scv.toXDR()).digest();
  h[0] &= 0x1f;
  return BigInt("0x" + h.toString("hex")).toString();
}
function jubRand() {
  const b = createHash("sha256").update(`r-${Math.random()}-${Date.now && ""}${process.hrtime.bigint()}`).digest("hex");
  return (BigInt("0x" + b) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n).toString();
}

const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const DEPLOYER = keyAddr("deployer");
const BOB = keyAddr("bob");
const CHARLIE = keyAddr("charlie");
const COMM = [keyAddr("comm1"), keyAddr("comm2"), keyAddr("comm3")];
const record = { network: NET, steps: {} };

console.log("[1] deploy market + pool; set pool as batcher");
const market = sh("stellar", ["contract", "deploy", "--wasm", resolve(REPO, "contracts/target/wasm32v1-none/release/lmsr_market.wasm"),
  "--source", "deployer", "--network", NET, "--", "--admin", DEPLOYER, "--collateral", XLM,
  "--b", (100n * S).toString(), "--asset", "XLM", "--threshold", "25000000000000", "--expiry", "2000000000"]).trim().split("\n").pop();
const mainVk = hexFrom("vk", resolve(CIRC, "output/main_verification_key.json"));
const depositVk = hexFrom("vk", resolve(CIRC, "output/deposit_vk.json"));
const pool = sh("stellar", ["contract", "deploy", "--wasm", resolve(REPO, "contracts/shielded-pool/target/wasm32v1-none/release/privacy_pools.wasm"),
  "--source", "deployer", "--network", NET, "--", "--vk_bytes", mainVk, "--deposit_vk_bytes", depositVk,
  "--token_address", XLM, "--admin", DEPLOYER, "--market", market, "--cap", "1000000000"]).trim().split("\n").pop();
console.log("    market:", market, "\n    pool:", pool);
invoke(market, "deployer", "set_batcher", ["--admin", DEPLOYER, "--batcher", pool]);
invoke(pool, "deployer", "set_committee", ["--caller", DEPLOYER, "--members", JSON.stringify(COMM), "--threshold", "2"]);
invoke(pool, "deployer", "set_redeem_v2_vk", ["--caller", DEPLOYER, "--vk_bytes", hexFrom("vk", resolve(CIRC, "build/order_redeem_v2_vk.json"))]);
record.contracts = { collateral_xlm_sac: XLM, lmsr_market: market, shielded_pool: pool };

console.log("[2] networked committee DKG (attest target = pool.submit_batch_committee)");
const TOKEN = "e2e-v2-token";
const members = { 1: "http://127.0.0.1:39741", 2: "http://127.0.0.1:39742", 3: "http://127.0.0.1:39743" };
const procs = Object.entries(members).map(([i, url]) =>
  spawn("node", [resolve(HERE, "member.mjs")], {
    env: { ...process.env, PORT: new URL(url).port, INDEX: i, MEMBER_TOKEN: TOKEN,
      ATTEST_TARGET: pool, ATTEST_METHOD: "submit_batch_committee", ATTEST_DQ_OFFSET: "1",
      MEMBER_SK: sh("stellar", ["keys", "show", `comm${i}`]).trim() },
    stdio: ["ignore", "inherit", "inherit"],
  })
);

const work = mkdtempSync(resolve(tmpdir(), "e2e-v2-"));
try {
  for (let k = 0; ; k++) {
    try { for (const u of Object.values(members)) if (!(await fetch(`${u}/health`)).ok) throw 0; break; }
    catch { if (k > 60) throw new Error("members not healthy"); await new Promise((r) => setTimeout(r, 100)); }
  }
  const dkg = await runDKG(members, 2, TOKEN);
  const pkDec = [dkg.pk[0].toString(), dkg.pk[1].toString()];
  console.log("    joint pk agreed");

  console.log("[3] place 4 orders on-chain (stake = shares * 10^7 collateral)");
  const orders = [
    { amount: "10", side: "1", secret: "100", nullifier: "101" },
    { amount: "20", side: "1", secret: "102", nullifier: "103" },
    { amount: "5", side: "0", secret: "104", nullifier: "105" },
    { amount: "15", side: "0", secret: "106", nullifier: "107" },
  ];
  const ordersPath = resolve(work, "orders.json");
  writeFileSync(ordersPath, JSON.stringify(orders));
  const tree = JSON.parse(sh(ORDER_TREE, [ordersPath, "16"]));
  for (const [k, o] of orders.entries()) {
    invoke(pool, "deployer", "place_order", ["--from", DEPLOYER,
      "--commitment", decToHex32(tree.orders[k].commitment),
      "--stake", (BigInt(o.amount) * DEC).toString()]);
  }
  const rootOnChain = invoke(pool, "deployer", "get_order_root", []).replace(/"/g, "");
  if (BigInt("0x" + rootOnChain) !== BigInt(tree.orderRoot)) throw new Error("order root mismatch");
  console.log("    4 orders placed; on-chain root matches tooling");

  console.log("[4] each trader proves encrypt_order (membership + ciphertext bound to pk)");
  const cyes = [], cno = [];
  for (const [k, o] of orders.entries()) {
    const leaf = tree.orders[k];
    const inp = { orderRoot: tree.orderRoot, amount: o.amount, side: o.side, secret: o.secret,
      nullifier: o.nullifier, ryes: jubRand(), rno: jubRand(), pk: pkDec,
      pathIndex: leaf.pathIndex, siblings: leaf.siblings };
    writeFileSync(resolve(work, `e${k}.json`), JSON.stringify(inp));
    sh("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), resolve(work, `e${k}.json`), resolve(work, `ew${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), resolve(work, `ew${k}.wtns`), resolve(work, `ep${k}.json`), resolve(work, `epub${k}.json`)]);
    sh(SNARKJS, ["groth16", "verify", resolve(CIRC, "build/encrypt_order_vk.json"), resolve(work, `epub${k}.json`), resolve(work, `ep${k}.json`)]);
    const pub = JSON.parse(readFileSync(resolve(work, `epub${k}.json`), "utf8"));
    if (pub[10] !== tree.orderRoot) throw new Error(`order ${k}: proof root mismatch`);
    cyes.push({ c1: [BigInt(pub[2]), BigInt(pub[3])], c2: [BigInt(pub[4]), BigInt(pub[5])] });
    cno.push({ c1: [BigInt(pub[6]), BigInt(pub[7])], c2: [BigInt(pub[8]), BigInt(pub[9])] });
    console.log(`    order ${k}: membership + encryption proof verified`);
  }

  console.log("[5] committee decrypts ONLY the net");
  const netYes = addCiphers(cyes), netNo = addCiphers(cno);
  const quorum = { 1: members[1], 3: members[3] };
  const yes = await collectPartials(quorum, dkg, netYes, TOKEN);
  const no = await collectPartials(quorum, dkg, netNo, TOKEN);
  console.log(`    net dqyes=${yes.net} dqno=${no.net} (expect 30, 20)`);
  if (yes.net !== 30n || no.net !== 20n) throw new Error("net mismatch");

  console.log("[6] pool.submit_batch_committee: committee attests, pool funds market, stores price");
  const cj = (c) => ({ c1: [c.c1[0].toString(), c.c1[1].toString()], c2: [c.c2[0].toString(), c.c2[1].toString()] });
  const payload = { cipherYes: cj(netYes), cipherNo: cj(netNo), partialsYes: yes.partials, partialsNo: no.partials, dqyes: yes.net.toString(), dqno: no.net.toString() };
  const addrToUrl = {};
  for (const [, url] of Object.entries(quorum)) { const h = await (await fetch(`${url}/health`)).json(); addrToUrl[h.address] = url; }
  const nullHashes = orders.map((_, k) => decToHex32(tree.orders[k].nullifierHash));
  const batch = await submitPoolBatch({
    pool, dqyesFp: (yes.net * S).toString(), dqnoFp: (no.net * S).toString(), nullHashes,
    signerAddrs: Object.keys(addrToUrl), sourceSk: process.env.FUNDER_SK,
    attest: async ({ address, entryXdr, validUntilLedger }) => (await attestEntry(addrToUrl[address], { entryXdr, validUntilLedger, ...payload }, TOKEN)).signedEntryXdr,
  });
  const price = invoke(pool, "deployer", "get_price", []).replace(/"/g, "");
  console.log(`    tx ${batch.hash}; net charged ${batch.net}; stored priceYes ${price}`);
  record.steps.batch = { tx: batch.hash, net_stroops: batch.net.toString(), priceYes: price };

  console.log("[7] fund market buffer, resolve Yes, pool claims winning shares");
  invoke(market, "deployer", "fund", ["--from", DEPLOYER, "--amount", "1000000000"]);
  invoke(market, "deployer", "resolve", ["--admin", DEPLOYER, "--outcome", '"Yes"']);
  const claimed = invoke(pool, "deployer", "claim_winnings", []);
  console.log(`    pool claimed winning collateral: ${claimed}`);

  console.log("[8] private redeems: winner (order 0) -> bob, loser (order 2) -> charlie");
  const redeem = async (k, to) => {
    const leaf = tree.orders[k], o = orders[k];
    const inp = { orderRoot: tree.orderRoot, recipient: recipientField(to), winningOutcome: "1",
      priceYes: price, fee: "1000000", amount: o.amount, side: o.side, secret: o.secret,
      nullifier: o.nullifier, pathIndex: leaf.pathIndex, siblings: leaf.siblings };
    writeFileSync(resolve(work, `r${k}.json`), JSON.stringify(inp));
    sh("node", [resolve(CIRC, "build/order_redeem_v2_js/generate_witness.js"), resolve(CIRC, "build/order_redeem_v2_js/order_redeem_v2.wasm"), resolve(work, `r${k}.json`), resolve(work, `rw${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "output/order_redeem_v2_final.zkey"), resolve(work, `rw${k}.wtns`), resolve(work, `rp${k}.json`), resolve(work, `rpub${k}.json`)]);
    const before = BigInt(invoke(XLM, "deployer", "balance", ["--id", to]).replace(/"/g, ""));
    relay(resolve(work, `rp${k}.json`), resolve(work, `rpub${k}.json`), to, { poolId: pool, source: "deployer" });
    const after = BigInt(invoke(XLM, "deployer", "balance", ["--id", to]).replace(/"/g, ""));
    return after - before;
  };
  const bobGain = await redeem(0, BOB);
  const charlieGain = await redeem(2, CHARLIE);
  const bobXlm = Number(bobGain) / 1e7, charlieXlm = Number(charlieGain) / 1e7;
  console.log(`    order 0 (10 YES, WIN)  -> bob +${bobXlm} XLM   (staked 10; fair profit ~4.75)`);
  console.log(`    order 2 (5 NO, LOSE)   -> charlie +${charlieXlm} XLM (staked 5; refund ~2.62)`);
  if (bobGain <= 10n * DEC) throw new Error("winner did not profit above stake");
  if (charlieGain <= 0n || charlieGain >= 5n * DEC) throw new Error("loser refund out of range");
  record.steps.redeems = { winner_bob_xlm: bobXlm, loser_charlie_xlm: charlieXlm };

  record.description = "Full-fledged economics live on testnet: sealed-bid LMSR batch auction. On-chain orders with real collateral escrow -> membership+encryption proofs -> committee decrypts only the net -> pool funds the market and stores the clearing price -> resolve -> pool reclaims winning shares -> private redeems pay winners a real profit and losers a refund. No individual order revealed.";
  writeFileSync(resolve(REPO, "deployments/full-economics-testnet.json"), JSON.stringify(record, null, 2) + "\n");
  console.log("PASS: full-fledged economics proven live. Record -> deployments/full-economics-testnet.json");
} finally {
  for (const p of procs) p.kill();
  rmSync(work, { recursive: true, force: true });
}
