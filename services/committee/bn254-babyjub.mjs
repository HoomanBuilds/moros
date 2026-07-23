import { randomBytes } from "node:crypto";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const SUBORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;
export const A = 168700n;
export const D = 168696n;
export const BASE8 = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];
export const IDENTITY = [0n, 1n];

export function mod(value, modulus = FIELD) {
  const reduced = value % modulus;
  return reduced < 0n ? reduced + modulus : reduced;
}

function power(base, exponent, modulus) {
  let result = 1n;
  let current = mod(base, modulus);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = (result * current) % modulus;
    current = (current * current) % modulus;
    remaining >>= 1n;
  }
  return result;
}

function inverse(value, modulus = FIELD) {
  if (mod(value, modulus) === 0n) throw new Error("division by zero");
  return power(value, modulus - 2n, modulus);
}

export function isPoint(point) {
  const [x, y] = point;
  if (x < 0n || x >= FIELD || y < 0n || y >= FIELD) return false;
  const x2 = mod(x * x);
  const y2 = mod(y * y);
  return mod(A * x2 + y2) === mod(1n + D * x2 * y2);
}

export function add(left, right) {
  if (!isPoint(left) || !isPoint(right)) throw new Error("invalid Baby Jubjub point");
  const [x1, y1] = left;
  const [x2, y2] = right;
  const product = mod(x1 * x2 * y1 * y2);
  return [
    mod((x1 * y2 + y1 * x2) * inverse(1n + D * product)),
    mod((y1 * y2 - A * x1 * x2) * inverse(1n - D * product)),
  ];
}

export function negate(point) {
  return [mod(-point[0]), point[1]];
}

export function multiply(point, scalar) {
  if (!isPoint(point)) throw new Error("invalid Baby Jubjub point");
  let result = IDENTITY;
  let addend = point;
  let remaining = mod(BigInt(scalar), SUBORDER);
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = add(result, addend);
    addend = add(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

export function randomScalar() {
  return mod(BigInt(`0x${randomBytes(40).toString("hex")}`), SUBORDER - 1n) + 1n;
}

export function publicKey(secret) {
  return multiply(BASE8, secret);
}

export function encryptSide(key, side, randomness = randomScalar()) {
  if (side !== 0 && side !== 1 && side !== 0n && side !== 1n) {
    throw new Error("side must be zero or one");
  }
  const c1 = multiply(BASE8, randomness);
  const shared = multiply(key, 8n * BigInt(randomness));
  const message = BigInt(side) === 1n ? BASE8 : IDENTITY;
  return { c1, c2: add(shared, message), randomness: BigInt(randomness) };
}

export function decryptSide(secret, ciphertext) {
  const shared = multiply(ciphertext.c1, 8n * BigInt(secret));
  const message = add(ciphertext.c2, negate(shared));
  if (message[0] === 0n && message[1] === 1n) return 0;
  if (message[0] === BASE8[0] && message[1] === BASE8[1]) return 1;
  throw new Error("ciphertext does not encode a Boolean side");
}

export function aggregateCiphertexts(ciphertexts) {
  return ciphertexts.reduce(
    (aggregate, ciphertext) => ({
      c1: add(aggregate.c1, ciphertext.c1),
      c2: add(aggregate.c2, ciphertext.c2),
    }),
    { c1: IDENTITY, c2: IDENTITY },
  );
}

export function reconstructSecret(shares) {
  if (shares.length === 0) throw new Error("at least one share is required");
  const indexes = shares.map((share) => BigInt(share.index));
  return shares.reduce((secret, share) => {
    const current = BigInt(share.index);
    let numerator = 1n;
    let denominator = 1n;
    for (const index of indexes) {
      if (index === current) continue;
      numerator = mod(numerator * -index, SUBORDER);
      denominator = mod(denominator * (current - index), SUBORDER);
    }
    const coefficient = mod(
      numerator * inverse(denominator, SUBORDER),
      SUBORDER,
    );
    return mod(secret + BigInt(share.value) * coefficient, SUBORDER);
  }, 0n);
}
