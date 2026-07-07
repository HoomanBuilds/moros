import * as snarkjs from "snarkjs";
import {
  init, dealerSetup, encrypt, addCiphers, partialDecrypt, thresholdDecrypt,
  randScalar, ptFromDec, ptToDec, eq,
} from "../services/committee/ec-elgamal.mjs";

const WASM = "build/encrypt_js/encrypt.wasm";
const ZKEY = "build/encrypt_final.zkey";
const VK = JSON.parse(await (await import("fs/promises")).readFile("build/encrypt_vk.json", "utf8"));

await init();
const { pk, shares } = dealerSetup(3, 2);
const pkDec = ptToDec(pk);

const orders = [
  { a: 10, s: 1 },
  { a: 20, s: 1 },
  { a: 5, s: 0 },
  { a: 15, s: 0 },
];

const cyesList = [];
const cnoList = [];
for (const [k, o] of orders.entries()) {
  const input = {
    amount: String(o.a),
    side: String(o.s),
    secret: randScalar().toString(),
    nullifier: randScalar().toString(),
    ryes: randScalar().toString(),
    rno: randScalar().toString(),
    pk: pkDec,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ok = await snarkjs.groth16.verify(VK, publicSignals, proof);
  if (!ok) { console.error(`order ${k}: proof FAILED to verify`); process.exit(1); }

  const cyes = { c1: ptFromDec(publicSignals[2], publicSignals[3]), c2: ptFromDec(publicSignals[4], publicSignals[5]) };
  const cno = { c1: ptFromDec(publicSignals[6], publicSignals[7]), c2: ptFromDec(publicSignals[8], publicSignals[9]) };

  const jsYes = encrypt(pk, o.s === 1 ? o.a : 0, BigInt(input.ryes));
  if (!eq(cyes.c1, jsYes.c1) || !eq(cyes.c2, jsYes.c2)) {
    console.error(`order ${k}: circuit ciphertext != committee-lib ciphertext`); process.exit(1);
  }
  cyesList.push(cyes);
  cnoList.push(cno);
  console.log(`order ${k} (a=${o.a}, side=${o.s}): ZK proof verified, ciphertext committee-compatible`);
}

const netYes = addCiphers(cyesList);
const netNo = addCiphers(cnoList);
const quorum = [shares[0], shares[2]];
const dqyes = thresholdDecrypt(netYes, quorum.map((sh) => partialDecrypt(sh, netYes)));
const dqno = thresholdDecrypt(netNo, quorum.map((sh) => partialDecrypt(sh, netNo)));

console.log("committee-decrypted net from ZK-proven ciphertexts: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) { console.error("FAIL: net mismatch"); process.exit(1); }
console.log("PASS: each trader proves a VALID encryption in ZK; aggregator sums; committee decrypts ONLY the net. Nobody sees an individual order.");
process.exit(0);
