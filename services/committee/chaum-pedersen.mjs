import { createHash } from "crypto";
import { G8, R, add, mul, eq, randScalar } from "./jubjub.mjs";

function hashToScalar(points) {
  const h = createHash("sha256");
  for (const p of points) {
    h.update(p[0].toString(16).padStart(64, "0"));
    h.update(p[1].toString(16).padStart(64, "0"));
  }
  return BigInt("0x" + h.digest("hex")) % R;
}

export function provePartial(share, c1) {
  const d = mul(c1, share.s);
  const y = mul(G8, share.s);
  const w = randScalar();
  const a1 = mul(G8, w);
  const a2 = mul(c1, w);
  const e = hashToScalar([y, c1, d, a1, a2]);
  const z = (w + e * share.s) % R;
  return { i: share.i, d, proof: { a1, a2, z } };
}

export function verifyPartial(y, c1, partial) {
  const { d, proof } = partial;
  const e = hashToScalar([y, c1, d, proof.a1, proof.a2]);
  if (!eq(mul(G8, proof.z), add(proof.a1, mul(y, e)))) return false;
  if (!eq(mul(c1, proof.z), add(proof.a2, mul(d, e)))) return false;
  return true;
}
