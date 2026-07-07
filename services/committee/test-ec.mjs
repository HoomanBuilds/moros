import { init, dealerSetup, encrypt, addCiphers, partialDecrypt, thresholdDecrypt } from "./ec-elgamal.mjs";

await init();
const { pk, shares } = dealerSetup(3, 2);

const orders = [
  { a: 10, s: 1 },
  { a: 20, s: 1 },
  { a: 5, s: 0 },
  { a: 15, s: 0 },
];
const netYes = addCiphers(orders.map((o) => encrypt(pk, o.s === 1 ? o.a : 0)));
const netNo = addCiphers(orders.map((o) => encrypt(pk, o.s === 0 ? o.a : 0)));

const quorum = [shares[0], shares[2]];
const dqyes = thresholdDecrypt(netYes, quorum.map((sh) => partialDecrypt(sh, netYes)));
const dqno = thresholdDecrypt(netNo, quorum.map((sh) => partialDecrypt(sh, netNo)));
console.log("EC committee-decrypted net: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) {
  console.error("FAIL: net mismatch");
  process.exit(1);
}

const one = [partialDecrypt(shares[0], netYes)];
let leaked = null;
try { leaked = thresholdDecrypt(netYes, one); } catch (_) {}
if (leaked === 30n) {
  console.error("FAIL: single share recovered the net");
  process.exit(1);
}
console.log("below threshold (1 of 3) does NOT recover the net:", leaked);
console.log("PASS: Baby Jubjub EC-ElGamal committee decrypts only the net; SNARK-compatible curve.");
