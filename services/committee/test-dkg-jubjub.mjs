import { encrypt, addCiphers, partialDecrypt, thresholdDecrypt, mul, eq, G8 } from "./jubjub.mjs";
import { pedersenDKG, memberVerifyKey } from "./dkg-jubjub.mjs";

const { pk, shares, commitments } = pedersenDKG(3, 2);
console.log("Jubjub DKG done: joint pk generated, no dealer ever held the key");

for (const sh of shares) {
  const y = memberVerifyKey(commitments, sh.i);
  if (!eq(y, mul(G8, sh.s))) {
    console.error(`FAIL: derived verify key for member ${sh.i} mismatch`);
    process.exit(1);
  }
}
console.log("per-member verify keys derivable from the public DKG transcript");

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
console.log("DKG-key committee-decrypted net: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) { console.error("FAIL"); process.exit(1); }

const below = thresholdDecrypt(netYes, [partialDecrypt(shares[0], netYes)]);
if (below === 30n) { console.error("FAIL: single share recovered net"); process.exit(1); }
console.log("PASS: Jubjub Pedersen DKG (Feldman-verified) works with threshold decryption.");
