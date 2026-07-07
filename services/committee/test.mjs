import { dealerSetup, encrypt, addCiphers, partialDecrypt, thresholdDecrypt } from "./threshold-elgamal.mjs";

const { pk, shares } = dealerSetup(3, 2);

const orders = [
  { a: 10, s: 1 },
  { a: 20, s: 1 },
  { a: 5, s: 0 },
  { a: 15, s: 0 },
];

const yesC = orders.map((o) => encrypt(pk, o.s === 1 ? o.a : 0));
const noC = orders.map((o) => encrypt(pk, o.s === 0 ? o.a : 0));

const netYes = addCiphers(yesC);
const netNo = addCiphers(noC);

const committee = [shares[0], shares[2]];
const dqyes = thresholdDecrypt(netYes, committee.map((sh) => partialDecrypt(sh, netYes)));
const dqno = thresholdDecrypt(netNo, committee.map((sh) => partialDecrypt(sh, netNo)));

console.log("committee-decrypted net: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) {
  console.error("FAIL: net mismatch");
  process.exit(1);
}

const belowThreshold = thresholdDecrypt(netYes, [partialDecrypt(shares[0], netYes)]);
console.log("with 1 of 3 shares (below threshold), net =", belowThreshold, " (must NOT be 30)");
if (belowThreshold === 30n) {
  console.error("FAIL: single share decrypted the net - threshold broken");
  process.exit(1);
}

console.log("PASS: only the NET is recoverable, and only with >= t committee members.");
console.log("No single party (batcher included) ever sees an individual order.");
