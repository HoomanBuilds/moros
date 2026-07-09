import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  dealerSetup, encrypt, addCiphers, partialDecrypt, thresholdDecrypt, randScalar, eq,
} from "./jubjub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const BIN = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/order_tree");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const WITGEN = resolve(CIRC, "build/encrypt_order_js/generate_witness.js");
const WASM = resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm");
const ZKEY = resolve(CIRC, "build/encrypt_order_final.zkey");
const VK = resolve(CIRC, "build/encrypt_order_vk.json");

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${r.stderr || r.stdout}`);
  return r;
}

const orders = [
  { amount: "10", side: "1", secret: "100", nullifier: "101" },
  { amount: "20", side: "1", secret: "102", nullifier: "103" },
  { amount: "5", side: "0", secret: "104", nullifier: "105" },
  { amount: "15", side: "0", secret: "106", nullifier: "107" },
];

const work = mkdtempSync(resolve(tmpdir(), "bls-link-"));
const ordersPath = resolve(work, "orders.json");
writeFileSync(ordersPath, JSON.stringify(orders));
const treeInput = JSON.parse(run(BIN, [ordersPath, "16"]).stdout);

const committee = dealerSetup(3, 2);
const pkDec = [committee.pk[0].toString(), committee.pk[1].toString()];

const cyesList = [];
const cnoList = [];
try {
  for (const [k, o] of orders.entries()) {
    const ryes = randScalar();
    const rno = randScalar();
    const inputPath = resolve(work, `in${k}.json`);
    const wtns = resolve(work, `w${k}.wtns`);
    const proofPath = resolve(work, `p${k}.json`);
    const pubPath = resolve(work, `pub${k}.json`);
    const leaf = treeInput.orders[k];
    writeFileSync(inputPath, JSON.stringify({ orderRoot: treeInput.orderRoot, ...o, ryes: ryes.toString(), rno: rno.toString(), pk: pkDec, pathIndex: leaf.pathIndex, siblings: leaf.siblings }));

    run("node", [WITGEN, WASM, inputPath, wtns]);
    run(SNARKJS, ["groth16", "prove", ZKEY, wtns, proofPath, pubPath]);
    run(SNARKJS, ["groth16", "verify", VK, pubPath, proofPath]);
    const pub = JSON.parse(readFileSync(pubPath, "utf8"));

    if (pub[0] !== leaf.commitment) {
      console.error(`order ${k}: circuit commitment ${pub[0]} != on-chain-tree leaf ${leaf.commitment}`);
      process.exit(1);
    }
    if (pub[10] !== treeInput.orderRoot) {
      console.error(`order ${k}: proof orderRoot mismatch`);
      process.exit(1);
    }

    const m = Number(o.side) === 1 ? Number(o.amount) : 0;
    const jsYes = encrypt(committee.pk, m, ryes);
    const cyes = { c1: [BigInt(pub[2]), BigInt(pub[3])], c2: [BigInt(pub[4]), BigInt(pub[5])] };
    const cno = { c1: [BigInt(pub[6]), BigInt(pub[7])], c2: [BigInt(pub[8]), BigInt(pub[9])] };
    if (!eq(cyes.c1, jsYes.c1) || !eq(cyes.c2, jsYes.c2)) {
      console.error(`order ${k}: circuit ciphertext != jubjub-lib ciphertext`);
      process.exit(1);
    }
    cyesList.push(cyes);
    cnoList.push(cno);
    console.log(`order ${k}: BLS proof verified, commitment == order-tree leaf, ciphertext committee-compatible`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const netYes = addCiphers(cyesList);
const netNo = addCiphers(cnoList);
const quorum = [committee.shares[0], committee.shares[2]];
const dqyes = thresholdDecrypt(netYes, quorum.map((sh) => partialDecrypt(sh, netYes)));
const dqno = thresholdDecrypt(netNo, quorum.map((sh) => partialDecrypt(sh, netNo)));

console.log("committee-decrypted net: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
console.log("order root (same tree the pool verifies redeems against):", treeInput.orderRoot);
if (dqyes !== 30n || dqno !== 20n) { console.error("FAIL: net mismatch"); process.exit(1); }
console.log("PASS: single curve BLS12-381. The ZK-proven encrypted orders ARE the on-chain order-tree leaves; the committee sees only the net; redeem stays on the existing order_redeem path.");
