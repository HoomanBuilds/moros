import {
  dealerSetup, encrypt, addCiphers, partialDecrypt, thresholdDecrypt, mul, add, eq, G8, ID, R,
} from "./jubjub.mjs";

const chk = mul(G8, R);
if (!eq(chk, ID)) { console.error("FAIL: generator order"); process.exit(1); }
if (!eq(mul(G8, 5n), add(mul(G8, 2n), mul(G8, 3n)))) { console.error("FAIL: group law"); process.exit(1); }

const { pk, shares } = dealerSetup(3, 2);
const orders = [
  { a: 10, s: 1 },
  { a: 20, s: 1 },
  { a: 5, s: 0 },
  { a: 15, s: 0 },
];
const netYes = addCiphers(orders.map((o) => encrypt(pk, o.s === 1 ? o.a : 0)));
const netNo = addCiphers(orders.map((o) => encrypt(pk, o.s === 0 ? o.a : 0)));

const quorum = [shares[1], shares[2]];
const dqyes = thresholdDecrypt(netYes, quorum.map((sh) => partialDecrypt(sh, netYes)));
const dqno = thresholdDecrypt(netNo, quorum.map((sh) => partialDecrypt(sh, netNo)));
console.log("Jubjub committee-decrypted net: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) { console.error("FAIL"); process.exit(1); }

const below = thresholdDecrypt(netYes, [partialDecrypt(shares[0], netYes)]);
if (below === 30n) { console.error("FAIL: single share recovered net"); process.exit(1); }
console.log("below threshold recovers:", below);
console.log("PASS: Jubjub (BLS12-381 embedded curve) threshold ElGamal works.");
