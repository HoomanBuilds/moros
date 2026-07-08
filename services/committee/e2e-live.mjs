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
import { submitCommitteeBatch } from "./submit-multisig.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const FORK = resolve(REPO, "inspiration/zk/soroban-privacy-pools");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const C2S = resolve(FORK, "target/release/stellar-circom2soroban");
const BATCH_BIN = resolve(FORK, "target/release/batch");
const NET = "testnet";
const S = 1n << 32n;

function sh(bin, args, desc) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${desc || bin} failed: ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
}
function invoke(id, source, fn, args) {
  const out = sh("stellar", [
    "contract", "invoke", "--id", id, "--source", source, "--network", NET, "--", fn, ...args,
  ], fn);
  return out.trim().split("\n").pop();
}
function keyAddr(name) {
  return sh("stellar", ["keys", "address", name]).trim();
}
function hexFrom(kind, jsonPath) {
  const out = sh(C2S, [kind, jsonPath]);
  const lines = out.split("\n").filter((l) => /^[0-9a-f]{40,}$/.test(l.trim()));
  return lines[lines.length - 1].trim();
}
function decToHex32(dec) {
  return BigInt(dec).toString(16).padStart(64, "0");
}
function recipientField(g) {
  const sc = xdr.ScVal.scvAddress(new Address(g).toScAddress());
  const h = createHash("sha256").update(sc.toXDR()).digest();
  h[0] &= 0x1f;
  return BigInt("0x" + h.toString("hex")).toString();
}

const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const DEPLOYER = keyAddr("deployer");
const BOB = keyAddr("bob");
const COMM = [keyAddr("comm1"), keyAddr("comm2"), keyAddr("comm3")];
const record = { network: NET, steps: {} };

console.log("[1] deploying market + pool");
const market = sh("stellar", [
  "contract", "deploy", "--wasm", resolve(REPO, "contracts/target/wasm32v1-none/release/lmsr_market.wasm"),
  "--source", "deployer", "--network", NET, "--",
  "--admin", DEPLOYER, "--collateral", XLM_SAC, "--b", (100n * S).toString(),
  "--asset", "XLM", "--threshold", "25000000000000", "--expiry", "2000000000",
]).trim().split("\n").pop();
console.log("    market:", market);

const mainVk = hexFrom("vk", resolve(CIRC, "output/main_verification_key.json"));
const depositVk = hexFrom("vk", resolve(CIRC, "output/deposit_vk.json"));
const pool = sh("stellar", [
  "contract", "deploy", "--wasm", resolve(REPO, "contracts/shielded-pool/target/wasm32v1-none/release/privacy_pools.wasm"),
  "--source", "deployer", "--network", NET, "--",
  "--vk_bytes", mainVk, "--deposit_vk_bytes", depositVk,
  "--token_address", XLM_SAC, "--admin", DEPLOYER, "--market", market, "--cap", "1000000000",
]).trim().split("\n").pop();
console.log("    pool:", pool);
record.contracts = { collateral_xlm_sac: XLM_SAC, lmsr_market: market, shielded_pool: pool };

console.log("[2] set committee (2-of-3) + redeem VK");
invoke(market, "deployer", "set_committee", [
  "--admin", DEPLOYER, "--members", JSON.stringify(COMM), "--threshold", "2",
]);
const redeemVk = hexFrom("vk", resolve(CIRC, "output/order_redeem_vk.json"));
invoke(pool, "deployer", "set_redeem_vk", ["--caller", DEPLOYER, "--vk_bytes", redeemVk]);
record.committee = { members: COMM, threshold: 2 };

console.log("[3] networked committee DKG (3 separate member processes)");
const TOKEN = "e2e-live-token";
const members = { 1: "http://127.0.0.1:39721", 2: "http://127.0.0.1:39722", 3: "http://127.0.0.1:39723" };
const procs = Object.entries(members).map(([i, url]) =>
  spawn("node", [resolve(HERE, "member.mjs")], {
    env: {
      ...process.env,
      PORT: new URL(url).port,
      INDEX: i,
      MEMBER_TOKEN: TOKEN,
      MARKET: market,
      MEMBER_SK: sh("stellar", ["keys", "show", `comm${i}`]).trim(),
    },
    stdio: ["ignore", "inherit", "inherit"],
  })
);

const work = mkdtempSync(resolve(tmpdir(), "e2e-live-"));
try {
  for (let k = 0; ; k++) {
    try {
      for (const url of Object.values(members)) if (!(await fetch(`${url}/health`)).ok) throw 0;
      break;
    } catch {
      if (k > 50) throw new Error("members never healthy");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const dkg = await runDKG(members, 2, TOKEN);
  const pkDec = [dkg.pk[0].toString(), dkg.pk[1].toString()];
  console.log("    joint pk agreed; no party holds the key");

  console.log("[4] place 4 orders on-chain (commitments = poseidon255 leaves)");
  const orders = [
    { amount: "10", side: "1", secret: "100", nullifier: "101" },
    { amount: "20", side: "1", secret: "102", nullifier: "103" },
    { amount: "5", side: "0", secret: "104", nullifier: "105" },
    { amount: "15", side: "0", secret: "106", nullifier: "107" },
  ];
  const ordersPath = resolve(work, "orders.json");
  writeFileSync(ordersPath, JSON.stringify(orders));
  const treeInput = JSON.parse(sh(BATCH_BIN, [ordersPath]));
  const leaves = [
    treeInput.siblings[1][0],
    treeInput.siblings[0][0],
    treeInput.siblings[3][0],
    treeInput.siblings[2][0],
  ];
  for (const [k, leaf] of leaves.entries()) {
    invoke(pool, "deployer", "place_order", [
      "--from", DEPLOYER, "--commitment", decToHex32(leaf), "--stake", orders[k].amount,
    ]);
    console.log(`    order ${k}: leaf placed, stake ${orders[k].amount}`);
  }
  const rootOnChain = invoke(pool, "deployer", "get_order_root", []).replace(/"/g, "");
  if (BigInt("0x" + rootOnChain) !== BigInt(treeInput.orderRoot)) throw new Error("order root mismatch on-chain vs tooling");
  console.log("    on-chain order root matches tooling:", treeInput.orderRoot);
  record.steps.orders = { count: 4, order_root: treeInput.orderRoot };

  console.log("[5] each trader proves encrypt_order (ciphertext bound to their leaf)");
  const cyes = [];
  const cno = [];
  for (const [k, o] of orders.entries()) {
    const rnd = () => {
      const b = createHash("sha256").update(`e2e-r-${k}-${o.secret}-${Math.random()}`).digest("hex");
      return (BigInt("0x" + b) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n).toString();
    };
    const inPath = resolve(work, `enc${k}.json`);
    writeFileSync(inPath, JSON.stringify({ ...o, ryes: rnd(), rno: rnd(), pk: pkDec }));
    sh("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), inPath, resolve(work, `w${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), resolve(work, `w${k}.wtns`), resolve(work, `p${k}.json`), resolve(work, `pub${k}.json`)]);
    sh(SNARKJS, ["groth16", "verify", resolve(CIRC, "build/encrypt_order_vk.json"), resolve(work, `pub${k}.json`), resolve(work, `p${k}.json`)]);
    const pub = JSON.parse(readFileSync(resolve(work, `pub${k}.json`), "utf8"));
    if (pub[0] !== leaves[k]) throw new Error(`order ${k}: proof commitment != on-chain leaf`);
    cyes.push({ c1: [BigInt(pub[2]), BigInt(pub[3])], c2: [BigInt(pub[4]), BigInt(pub[5])] });
    cno.push({ c1: [BigInt(pub[6]), BigInt(pub[7])], c2: [BigInt(pub[8]), BigInt(pub[9])] });
    rmSync(inPath, { force: true });
    rmSync(resolve(work, `w${k}.wtns`), { force: true });
    console.log(`    order ${k}: proof verified, commitment == on-chain leaf`);
  }

  console.log("[6] aggregator sums ciphertexts; committee decrypts ONLY the net");
  const netYes = addCiphers(cyes);
  const netNo = addCiphers(cno);
  const quorum = { 1: members[1], 3: members[3] };
  const yes = await collectPartials(quorum, dkg, netYes, TOKEN);
  const no = await collectPartials(quorum, dkg, netNo, TOKEN);
  const dqyes = yes.net;
  const dqno = no.net;
  console.log(`    net: dqyes=${dqyes} dqno=${dqno} (expect 30, 20)`);
  if (dqyes !== 30n || dqno !== 20n) throw new Error("net mismatch");
  record.steps.committee_net = { dqyes: dqyes.toString(), dqno: dqno.toString(), partials: "Chaum-Pedersen verified" };

  console.log("[7] apply_batch_committee: members verify the net and sign their OWN auth entries");
  const cipherJson = (c) => ({ c1: [c.c1[0].toString(), c.c1[1].toString()], c2: [c.c2[0].toString(), c.c2[1].toString()] });
  const attestPayload = {
    cipherYes: cipherJson(netYes),
    cipherNo: cipherJson(netNo),
    partialsYes: yes.partials,
    partialsNo: no.partials,
    dqyes: dqyes.toString(),
    dqno: dqno.toString(),
  };
  const addrToUrl = {};
  for (const [i, url] of Object.entries(quorum)) {
    const h = await (await fetch(`${url}/health`)).json();
    addrToUrl[h.address] = url;
  }
  const batch = await submitCommitteeBatch({
    market,
    dqyes: (dqyes * S).toString(),
    dqno: (dqno * S).toString(),
    funderSk: process.env.FUNDER_SK,
    signerAddrs: Object.keys(addrToUrl),
    attest: async ({ address, entryXdr, validUntilLedger }) => {
      const r = await attestEntry(addrToUrl[address], { entryXdr, validUntilLedger, ...attestPayload }, TOKEN);
      return r.signedEntryXdr;
    },
  });
  console.log(`    tx ${batch.hash} net charged ${batch.net}`);
  record.steps.apply_batch_committee = {
    tx: batch.hash, net_stroops: batch.net.toString(),
    dqyes_fp: (dqyes * S).toString(), dqno_fp: (dqno * S).toString(),
    signing: "each member verified the decryption and signed its own auth entry (server never held committee keys)",
  };

  console.log("[8] fund market buffer + resolve Yes");
  invoke(market, "deployer", "fund", ["--from", DEPLOYER, "--amount", "100000000"]);
  invoke(market, "deployer", "resolve", ["--admin", DEPLOYER, "--outcome", '"Yes"']);
  console.log("    resolved: Yes");

  console.log("[9] private relayer redeem of winning order 0 (amount 10) to bob");
  const balBefore = BigInt(invoke(XLM_SAC, "deployer", "balance", ["--id", BOB]).replace(/"/g, ""));
  const redeemInput = {
    orderRoot: treeInput.orderRoot,
    recipient: recipientField(BOB),
    winningOutcome: "1",
    amount: orders[0].amount,
    side: orders[0].side,
    secret: orders[0].secret,
    nullifier: orders[0].nullifier,
    pathIndex: treeInput.pathIndex[0],
    siblings: treeInput.siblings[0],
  };
  const rIn = resolve(work, "redeem_in.json");
  writeFileSync(rIn, JSON.stringify(redeemInput));
  sh("node", [resolve(CIRC, "build/order_redeem_js/generate_witness.js"), resolve(CIRC, "build/order_redeem_js/order_redeem.wasm"), rIn, resolve(work, "r.wtns")]);
  sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "output/order_redeem_final.zkey"), resolve(work, "r.wtns"), resolve(work, "rp.json"), resolve(work, "rpub.json")]);
  const proofHex = hexFrom("proof", resolve(work, "rp.json"));
  const pubHex = hexFrom("public", resolve(work, "rpub.json"));
  const out = invoke(pool, "deployer", "redeem_order", ["--to", BOB, "--proof_bytes", proofHex, "--pub_signals_bytes", pubHex]);
  console.log("    redeem result:", out);
  const balAfter = BigInt(invoke(XLM_SAC, "deployer", "balance", ["--id", BOB]).replace(/"/g, ""));
  console.log(`    bob balance: ${balBefore} -> ${balAfter} (expect +10)`);
  if (balAfter - balBefore !== 10n) throw new Error("payout mismatch");
  record.steps.redeem = { recipient: BOB, payout: "10", submitter: "deployer (relayer, no recipient signature)" };

  record.description = "Full no-leak flow live on testnet: on-chain orders (poseidon255 leaves) -> per-trader encrypt_order proofs bound to those leaves -> trustless aggregation -> networked 2-of-3 committee (DKG, Chaum-Pedersen verified partials) decrypts only the net -> multisig apply_batch_committee moves LMSR odds -> resolve -> private relayer redeem pays the winner from the pool. No party saw an individual order: the chain holds commitments, the aggregator holds ciphertexts, each committee member holds a share.";
  writeFileSync(resolve(REPO, "deployments/full-e2e-committee-testnet.json"), JSON.stringify(record, null, 2) + "\n");
  console.log("PASS: full combined live E2E complete. Record written to deployments/full-e2e-committee-testnet.json");
} finally {
  for (const p of procs) p.kill();
  rmSync(work, { recursive: true, force: true });
}
