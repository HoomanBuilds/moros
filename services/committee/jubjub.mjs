import { randomBytes } from "crypto";

export const Q = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;
export const R = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
export const D = 19257038036680949359750312669786877991949435402254120286184196891950884077233n;
export const G8 = [
  26425721312295396735536009845259662215154440146657062145727563247428679108070n,
  33870355149453697655464584064870436861767017640968433840972803788419917420560n,
];
export const ID = [0n, 1n];

function mod(x, m = Q) {
  x %= m;
  return x < 0n ? x + m : x;
}
function modpow(b, e, m = Q) {
  b = mod(b, m);
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
function modinv(a, m = Q) {
  return modpow(a, m - 2n, m);
}

export function add(P, S) {
  const [x1, y1] = P, [x2, y2] = S;
  const t = mod(((((D * x1) % Q) * x2) % Q) * ((y1 * y2) % Q));
  const x3 = mod(((x1 * y2 + y1 * x2) % Q) * modinv(mod(1n + t)));
  const y3 = mod(((y1 * y2 + x1 * x2) % Q) * modinv(mod(1n - t)));
  return [x3, y3];
}
export function neg(P) {
  return [mod(-P[0]), P[1]];
}
export function mul(P, k) {
  let acc = ID, base = P;
  k = mod(k, R);
  while (k > 0n) {
    if (k & 1n) acc = add(acc, base);
    base = add(base, base);
    k >>= 1n;
  }
  return acc;
}
export function eq(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

export function randScalar() {
  return mod(BigInt("0x" + randomBytes(40).toString("hex")), R - 1n) + 1n;
}

function evalPoly(coeffs, x) {
  let y = 0n, xp = 1n;
  for (const c of coeffs) {
    y = mod(y + c * xp, R);
    xp = mod(xp * x, R);
  }
  return y;
}

export function dealerSetup(n, t) {
  const sk = randScalar();
  const coeffs = [sk];
  for (let i = 1; i < t; i++) coeffs.push(randScalar());
  const shares = [];
  for (let x = 1n; x <= BigInt(n); x++) shares.push({ i: x, s: evalPoly(coeffs, x) });
  return { pk: mul(G8, sk), shares, n, t };
}

export function encrypt(pk, m, r = randScalar()) {
  return { c1: mul(G8, r), c2: add(mul(G8, BigInt(m)), mul(pk, r)) };
}

export function addCiphers(list) {
  return list.reduce((a, b) => ({ c1: add(a.c1, b.c1), c2: add(a.c2, b.c2) }), { c1: ID, c2: ID });
}

export function partialDecrypt(share, cipher) {
  return { i: share.i, d: mul(cipher.c1, share.s) };
}

function lagrangeAtZero(indices, i) {
  let num = 1n, den = 1n;
  for (const j of indices) {
    if (j === i) continue;
    num = mod(num * mod(-j, R), R);
    den = mod(den * mod(i - j, R), R);
  }
  return mod(num * modpow(den, R - 2n, R), R);
}

function bsgs(M, bound) {
  const m = BigInt(Math.ceil(Math.sqrt(Number(bound))) + 1);
  const table = new Map();
  let e = ID;
  for (let j = 0n; j < m; j++) {
    table.set(e[0] + "," + e[1], j);
    e = add(e, G8);
  }
  const step = neg(mul(G8, m));
  let gamma = M;
  for (let i = 0n; i <= m; i++) {
    const hit = table.get(gamma[0] + "," + gamma[1]);
    if (hit !== undefined) return i * m + hit;
    gamma = add(gamma, step);
  }
  return null;
}

export function thresholdDecrypt(cipher, partials, bound = 100000) {
  const indices = partials.map((p) => p.i);
  let S = ID;
  for (const p of partials) {
    S = add(S, mul(p.d, lagrangeAtZero(indices, p.i)));
  }
  return bsgs(add(cipher.c2, neg(S)), bound);
}
