import { P, G, Q, modpow, randScalar } from "./threshold-elgamal.mjs";

function evalPoly(coeffs, x) {
  let y = 0n, xp = 1n;
  for (const c of coeffs) {
    y = (y + c * xp) % Q;
    xp = (xp * x) % Q;
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
    commitments.push(coeffs.map((c) => modpow(G, c, P)));
  }

  const shares = [];
  for (let j = 1n; j <= BigInt(n); j++) {
    let s = 0n;
    for (let i = 0; i < n; i++) {
      const sub = evalPoly(polys[i], j);
      let check = 1n, xp = 1n;
      for (const cm of commitments[i]) {
        check = (check * modpow(cm, xp, P)) % P;
        xp = (xp * j) % Q;
      }
      if (modpow(G, sub, P) !== check) {
        throw new Error(`DKG: member ${i + 1} sent an invalid share to ${j}`);
      }
      s = (s + sub) % Q;
    }
    shares.push({ i: j, s });
  }

  let pk = 1n;
  for (let i = 0; i < n; i++) pk = (pk * commitments[i][0]) % P;
  return { pk, shares, n, t };
}
