import { encrypt, addCiphers, thresholdDecrypt, mul, G8 } from "./jubjub.mjs";
import { pedersenDKG, memberVerifyKey } from "./dkg-jubjub.mjs";
import { provePartial, verifyPartial } from "./chaum-pedersen.mjs";

const { pk, shares, commitments } = pedersenDKG(3, 2);
const orders = [
  { a: 10, s: 1 },
  { a: 20, s: 1 },
  { a: 5, s: 0 },
  { a: 15, s: 0 },
];
const netYes = addCiphers(orders.map((o) => encrypt(pk, o.s === 1 ? o.a : 0)));
const netNo = addCiphers(orders.map((o) => encrypt(pk, o.s === 0 ? o.a : 0)));

const quorum = [shares[0], shares[2]];
const verified = [];
for (const sh of quorum) {
  const y = memberVerifyKey(commitments, sh.i);
  const p = provePartial(sh, netYes.c1);
  if (!verifyPartial(y, netYes.c1, p)) {
    console.error(`FAIL: honest partial from member ${sh.i} rejected`);
    process.exit(1);
  }
  verified.push(p);
}
console.log("honest partial decryptions: proofs verify");

const liar = provePartial(quorum[0], netYes.c1);
liar.d = mul(G8, 42n);
const yLiar = memberVerifyKey(commitments, quorum[0].i);
if (verifyPartial(yLiar, netYes.c1, liar)) {
  console.error("FAIL: forged partial accepted");
  process.exit(1);
}
console.log("forged partial decryption: proof REJECTED");

const wrongCipher = provePartial(quorum[0], netNo.c1);
if (verifyPartial(yLiar, netYes.c1, wrongCipher)) {
  console.error("FAIL: partial for a different ciphertext accepted");
  process.exit(1);
}
console.log("partial bound to the wrong ciphertext: proof REJECTED");

const dqyes = thresholdDecrypt(netYes, verified.map(({ i, d }) => ({ i, d })));
const partsNo = quorum.map((sh) => {
  const p = provePartial(sh, netNo.c1);
  if (!verifyPartial(memberVerifyKey(commitments, sh.i), netNo.c1, p)) process.exit(1);
  return { i: p.i, d: p.d };
});
const dqno = thresholdDecrypt(netNo, partsNo);
console.log("net from verified partials: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
if (dqyes !== 30n || dqno !== 20n) { console.error("FAIL"); process.exit(1); }
console.log("PASS: Chaum-Pedersen partial-decryption proofs; lying members are caught before combining.");
