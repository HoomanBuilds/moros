import { encrypt, addCiphers, partialDecrypt, thresholdDecrypt } from "./threshold-elgamal.mjs";
import { pedersenDKG } from "./dkg.mjs";

const { pk, shares } = pedersenDKG(3, 2);
console.log("DKG done: joint pk generated, no dealer held the key");

const orders = [
  { a: 10, s: 1 },
  { a: 20, s: 1 },
  { a: 5, s: 0 },
  { a: 15, s: 0 },
];
const netYes = addCiphers(orders.map((o) => encrypt(pk, o.s === 1 ? o.a : 0)));
const netNo = addCiphers(orders.map((o) => encrypt(pk, o.s === 0 ? o.a : 0)));

const committee = [shares[1], shares[2]];
const dqyes = thresholdDecrypt(netYes, committee.map((sh) => partialDecrypt(sh, netYes)));
const dqno = thresholdDecrypt(netNo, committee.map((sh) => partialDecrypt(sh, netNo)));

console.log("DKG-key committee-decrypted net: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS: DKG-generated key works with threshold decryption; no party ever held the full key.");
