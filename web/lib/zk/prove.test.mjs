import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as snarkjs from "snarkjs";
import { dealerSetup, encrypt, partialDecrypt, thresholdDecrypt, randScalar, eq } from "../../../services/committee/jubjub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const ZK = resolve(HERE, "..", "..", "public", "zk");
const BIN = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/order_tree");

const COMMIT_WASM = resolve(ZK, "order_commit.wasm");
const WASM = resolve(ZK, "encrypt_order.wasm");
const ZKEY = resolve(ZK, "encrypt_order_final.zkey");
const VK = JSON.parse(readFileSync(resolve(ZK, "encrypt_order_vk.json"), "utf8"));

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${r.stderr || r.stdout}`);
  return r;
}

const order = { amount: "10", side: "1", secret: "100", nullifier: "101" };

const wtns = { type: "mem" };
await snarkjs.wtns.calculate(order, COMMIT_WASM, wtns);
const witness = await snarkjs.wtns.exportJson(wtns);
const commitment = witness[1].toString();
const nullifierHash = witness[2].toString();

const work = mkdtempSync(resolve(tmpdir(), "web-zk-"));
let treeInput;
try {
  const ordersPath = resolve(work, "orders.json");
  writeFileSync(ordersPath, JSON.stringify([order]));
  treeInput = JSON.parse(run(BIN, [ordersPath, "16"]).stdout);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (treeInput.orders[0].commitment !== commitment) {
  console.error(`FAIL: order_commit.wasm commitment ${commitment} != order-tree leaf ${treeInput.orders[0].commitment}`);
  process.exit(1);
}
if (treeInput.orders[0].nullifierHash !== nullifierHash) {
  console.error(`FAIL: order_commit.wasm nullifierHash ${nullifierHash} != order-tree leaf ${treeInput.orders[0].nullifierHash}`);
  process.exit(1);
}
console.log(`commit hasher ok: commitment ${commitment} matches order-tree leaf`);

const committee = dealerSetup(3, 2);
const pkDec = [committee.pk[0].toString(), committee.pk[1].toString()];
const ryes = randScalar();
const rno = randScalar();
const leaf = treeInput.orders[0];

const input = {
  orderRoot: treeInput.orderRoot,
  ...order,
  ryes: ryes.toString(),
  rno: rno.toString(),
  pk: pkDec,
  pathIndex: leaf.pathIndex,
  siblings: leaf.siblings,
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
const verified = await snarkjs.groth16.verify(VK, publicSignals, proof);
if (!verified) {
  console.error("FAIL: groth16 proof did not verify against served encrypt_order_vk.json");
  process.exit(1);
}
if (publicSignals[0] !== commitment) {
  console.error(`FAIL: circuit commitment ${publicSignals[0]} != ${commitment}`);
  process.exit(1);
}
if (publicSignals[10] !== treeInput.orderRoot) {
  console.error("FAIL: proof orderRoot mismatch");
  process.exit(1);
}
console.log("groth16 proof verified against served encrypt_order.wasm / encrypt_order_final.zkey");

const m = Number(order.side) === 1 ? Number(order.amount) : 0;
const jsYes = encrypt(committee.pk, m, ryes);
const cyes = { c1: [BigInt(publicSignals[2]), BigInt(publicSignals[3])], c2: [BigInt(publicSignals[4]), BigInt(publicSignals[5])] };
const cno = { c1: [BigInt(publicSignals[6]), BigInt(publicSignals[7])], c2: [BigInt(publicSignals[8]), BigInt(publicSignals[9])] };
if (!eq(cyes.c1, jsYes.c1) || !eq(cyes.c2, jsYes.c2)) {
  console.error("FAIL: circuit ciphertext != jubjub-lib ciphertext");
  process.exit(1);
}

const dqyes = thresholdDecrypt(cyes, [committee.shares[0], committee.shares[2]].map((sh) => partialDecrypt(sh, cyes)));
const dqno = thresholdDecrypt(cno, [committee.shares[0], committee.shares[2]].map((sh) => partialDecrypt(sh, cno)));
if (dqyes !== 10n || dqno !== 0n) {
  console.error(`FAIL: committee decrypt mismatch (dqyes=${dqyes} dqno=${dqno}, expected 10, 0)`);
  process.exit(1);
}

console.log("PASS: served web/public/zk artifacts produce a verifying groth16 proof, the commitment matches the order-tree leaf, and the committee decrypts the ciphertext to the expected amount");
process.exit(0);
