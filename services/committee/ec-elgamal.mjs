import { randomBytes } from "crypto";
import { buildBabyjub } from "circomlibjs";

let bj = null;
export async function init() {
  if (!bj) bj = await buildBabyjub();
  return bj;
}

const L = () => bj.subOrder;
const ID = () => [bj.F.e(0n), bj.F.e(1n)];
function key(P) {
  return bj.F.toString(P[0]) + "," + bj.F.toString(P[1]);
}
function neg(P) {
  return [bj.F.neg(P[0]), P[1]];
}

function mod(x, m) {
  x %= m;
  return x < 0n ? x + m : x;
}
function modinv(a, m) {
  let [og, g] = [mod(a, m), m], [os, s] = [1n, 0n];
  while (g !== 0n) {
    const q = og / g;
    [og, g] = [g, og - q * g];
    [os, s] = [s, os - q * s];
  }
  return mod(os, m);
}

export function randScalar() {
  return mod(BigInt("0x" + randomBytes(32).toString("hex")), L() - 1n) + 1n;
}

function evalPoly(coeffs, x) {
  const l = L();
  let y = 0n, xp = 1n;
  for (const c of coeffs) {
    y = mod(y + c * xp, l);
    xp = mod(xp * x, l);
  }
  return y;
}

export function dealerSetup(n, t) {
  const sk = randScalar();
  const coeffs = [sk];
  for (let i = 1; i < t; i++) coeffs.push(randScalar());
  const shares = [];
  for (let x = 1n; x <= BigInt(n); x++) shares.push({ i: x, s: evalPoly(coeffs, x) });
  return { pk: bj.mulPointEscalar(bj.Base8, sk), shares, n, t };
}

export function encrypt(pk, m, r = randScalar()) {
  const c1 = bj.mulPointEscalar(bj.Base8, r);
  const mB = bj.mulPointEscalar(bj.Base8, BigInt(m));
  const c2 = bj.addPoint(mB, bj.mulPointEscalar(pk, r));
  return { c1, c2 };
}

export function addCiphers(list) {
  let c1 = ID(), c2 = ID();
  for (const c of list) {
    c1 = bj.addPoint(c1, c.c1);
    c2 = bj.addPoint(c2, c.c2);
  }
  return { c1, c2 };
}

export function partialDecrypt(share, cipher) {
  return { i: share.i, d: bj.mulPointEscalar(cipher.c1, share.s) };
}

function lagrangeAtZero(indices, i) {
  const l = L();
  let num = 1n, den = 1n;
  for (const j of indices) {
    if (j === i) continue;
    num = mod(num * mod(-j, l), l);
    den = mod(den * mod(i - j, l), l);
  }
  return mod(num * modinv(den, l), l);
}

function bsgs(M, bound) {
  const m = BigInt(Math.ceil(Math.sqrt(Number(bound))) + 1);
  const table = new Map();
  let e = ID();
  for (let j = 0n; j < m; j++) {
    table.set(key(e), j);
    e = bj.addPoint(e, bj.Base8);
  }
  const step = neg(bj.mulPointEscalar(bj.Base8, m));
  let gamma = M;
  for (let i = 0n; i <= m; i++) {
    const hit = table.get(key(gamma));
    if (hit !== undefined) return i * m + hit;
    gamma = bj.addPoint(gamma, step);
  }
  return null;
}

export function ptFromDec(x, y) {
  return [bj.F.e(BigInt(x)), bj.F.e(BigInt(y))];
}
export function ptToDec(P) {
  return [bj.F.toString(P[0]), bj.F.toString(P[1])];
}
export function eq(a, b) {
  return bj.F.eq(a[0], b[0]) && bj.F.eq(a[1], b[1]);
}

export function thresholdDecrypt(cipher, partials, bound = 100000) {
  const indices = partials.map((p) => p.i);
  let S = ID();
  for (const p of partials) {
    S = bj.addPoint(S, bj.mulPointEscalar(p.d, lagrangeAtZero(indices, p.i)));
  }
  return bsgs(bj.addPoint(cipher.c2, neg(S)), bound);
}
