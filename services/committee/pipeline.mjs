import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFile } from "fs/promises";
import * as snarkjs from "snarkjs";
import {
  init, dealerSetup, encrypt, addCiphers, partialDecrypt, thresholdDecrypt,
  randScalar, ptToDec, ptFromDec, eq,
} from "./ec-elgamal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CIRCUITS = resolve(HERE, "../../circuits");
const WASM = resolve(CIRCUITS, "build/encrypt_js/encrypt.wasm");
const ZKEY = resolve(CIRCUITS, "build/encrypt_final.zkey");
const VK_PATH = resolve(CIRCUITS, "build/encrypt_vk.json");

export async function proveOrder(order, pkDec) {
  const input = {
    amount: String(order.a),
    side: String(order.s),
    secret: (order.secret ?? randScalar()).toString(),
    nullifier: (order.nullifier ?? randScalar()).toString(),
    ryes: randScalar().toString(),
    rno: randScalar().toString(),
    pk: pkDec,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return {
    proof,
    publicSignals,
    cyes: { c1: ptFromDec(publicSignals[2], publicSignals[3]), c2: ptFromDec(publicSignals[4], publicSignals[5]) },
    cno: { c1: ptFromDec(publicSignals[6], publicSignals[7]), c2: ptFromDec(publicSignals[8], publicSignals[9]) },
  };
}

export async function runNoLeakBatch(orders, committee) {
  await init();
  const pkDec = ptToDec(committee.pk);
  const vk = JSON.parse(await readFile(VK_PATH, "utf8"));

  const proven = [];
  for (const o of orders) proven.push(await proveOrder(o, pkDec));

  for (const [k, p] of proven.entries()) {
    const ok = await snarkjs.groth16.verify(vk, p.publicSignals, p.proof);
    if (!ok) throw new Error(`order ${k}: encryption-validity proof rejected`);
  }

  const netYes = addCiphers(proven.map((p) => p.cyes));
  const netNo = addCiphers(proven.map((p) => p.cno));
  const quorum = committee.shares.slice(0, committee.t);
  const dqyes = thresholdDecrypt(netYes, quorum.map((sh) => partialDecrypt(sh, netYes)));
  const dqno = thresholdDecrypt(netNo, quorum.map((sh) => partialDecrypt(sh, netNo)));

  return { dqyes, dqno, count: orders.length, proofsVerified: proven.length };
}

async function main() {
  await init();
  const committee = dealerSetup(3, 2);
  committee.t = 2;
  const orders = [
    { a: 10, s: 1 },
    { a: 20, s: 1 },
    { a: 5, s: 0 },
    { a: 15, s: 0 },
  ];
  const { dqyes, dqno, count, proofsVerified } = await runNoLeakBatch(orders, committee);
  console.log(`orders: ${count}, encryption-validity proofs verified: ${proofsVerified}`);
  console.log(`committee-decrypted net -> dqyes=${dqyes}, dqno=${dqno}`);
  const S = 1n << 32n;
  console.log("\non-chain call (t-of-n committee attests the net):");
  console.log(`  apply_batch_committee(signers=[m1,m2], funder, dqyes=${dqyes * S}, dqno=${dqno * S})`);
  console.log("\nnobody (aggregator included) saw an individual order; only the net left the committee.");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
