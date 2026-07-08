import { G8, ID, R, add, mul, eq, randScalar } from "./jubjub.mjs";

function mod(x, m = R) {
  x %= m;
  return x < 0n ? x + m : x;
}

function evalPoly(coeffs, x) {
  let y = 0n, xp = 1n;
  for (const c of coeffs) {
    y = mod(y + c * xp);
    xp = mod(xp * x);
  }
  return y;
}

export function feldmanCheck(commitments, j, share) {
  let expect = ID, xp = 1n;
  for (const cm of commitments) {
    expect = add(expect, mul(cm, xp));
    xp = mod(xp * j);
  }
  return eq(mul(G8, share), expect);
}

export function memberVerifyKey(allCommitments, j) {
  let y = ID;
  for (const cms of allCommitments) {
    let xp = 1n;
    for (const cm of cms) {
      y = add(y, mul(cm, xp));
      xp = mod(xp * j);
    }
  }
  return y;
}

export function pedersenDKG(n, t) {
  const polys = [];
  const commitments = [];
  for (let i = 0; i < n; i++) {
    const coeffs = [];
    for (let k = 0; k < t; k++) coeffs.push(randScalar());
    polys.push(coeffs);
    commitments.push(coeffs.map((c) => mul(G8, c)));
  }

  const shares = [];
  for (let j = 1n; j <= BigInt(n); j++) {
    let s = 0n;
    for (let i = 0; i < n; i++) {
      const sub = evalPoly(polys[i], j);
      if (!feldmanCheck(commitments[i], j, sub)) {
        throw new Error(`DKG: member ${i + 1} sent an invalid share to ${j}`);
      }
      s = mod(s + sub);
    }
    shares.push({ i: j, s });
  }

  let pk = ID;
  for (let i = 0; i < n; i++) pk = add(pk, commitments[i][0]);
  return { pk, shares, commitments, n, t };
}
