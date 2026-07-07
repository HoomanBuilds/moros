import { randomBytes } from "crypto";

const P = BigInt(
  "0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF"
);
const G = 2n;
const Q = (P - 1n) / 2n;

function modpow(b, e, m) {
  b %= m;
  if (b < 0n) b += m;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function modinv(a, m) {
  let [old_r, r] = [((a % m) + m) % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % m) + m) % m;
}

function randScalar() {
  const x = BigInt("0x" + randomBytes(40).toString("hex")) % (Q - 1n);
  return x + 1n;
}

function shamirShare(secret, n, t) {
  const coeffs = [secret];
  for (let i = 1; i < t; i++) coeffs.push(randScalar());
  const shares = [];
  for (let x = 1n; x <= BigInt(n); x++) {
    let y = 0n, xp = 1n;
    for (const c of coeffs) {
      y = (y + c * xp) % Q;
      xp = (xp * x) % Q;
    }
    shares.push({ i: x, s: y });
  }
  return shares;
}

function lagrangeAtZero(indices, i) {
  let num = 1n, den = 1n;
  for (const j of indices) {
    if (j === i) continue;
    num = (num * ((-j % Q) + Q)) % Q;
    den = (den * ((i - j) % Q + Q)) % Q;
  }
  return (num * modinv(den, Q)) % Q;
}

export function dealerSetup(n, t) {
  const sk = randScalar();
  return { pk: modpow(G, sk, P), shares: shamirShare(sk, n, t), n, t };
}

export function encrypt(pk, m, r = randScalar()) {
  return { c1: modpow(G, r, P), c2: (modpow(G, BigInt(m), P) * modpow(pk, r, P)) % P };
}

export function addCiphers(list) {
  return list.reduce((a, b) => ({ c1: (a.c1 * b.c1) % P, c2: (a.c2 * b.c2) % P }), { c1: 1n, c2: 1n });
}

export function partialDecrypt(share, cipher) {
  return { i: share.i, d: modpow(cipher.c1, share.s, P) };
}

function bsgs(target, bound) {
  const m = BigInt(Math.ceil(Math.sqrt(Number(bound))) + 1);
  const table = new Map();
  let e = 1n;
  for (let j = 0n; j < m; j++) {
    table.set(e.toString(), j);
    e = (e * G) % P;
  }
  const factor = modpow(modinv(modpow(G, m, P), P), 1n, P);
  let gamma = target;
  for (let i = 0n; i <= m; i++) {
    const hit = table.get(gamma.toString());
    if (hit !== undefined) return i * m + hit;
    gamma = (gamma * factor) % P;
  }
  return null;
}

export function thresholdDecrypt(cipher, partials, bound = 1_000_000) {
  const indices = partials.map((p) => p.i);
  let s = 1n;
  for (const p of partials) {
    const lam = lagrangeAtZero(indices, p.i);
    s = (s * modpow(p.d, lam, P)) % P;
  }
  const gm = (cipher.c2 * modinv(s, P)) % P;
  return bsgs(gm, bound);
}
