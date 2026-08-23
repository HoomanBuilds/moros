"use client";

import * as snarkjs from "snarkjs";
import type { PaymentDeployment } from "@moros/payments-client";
import { PAYMENT_PUBLIC_SIGNALS } from "./payment-protocol";

type Groth16Point = Array<string | number | bigint | Groth16Point>;
type Groth16Proof = {
  protocol?: unknown;
  curve?: unknown;
  pi_a?: Groth16Point;
  pi_b?: Groth16Point;
  pi_c?: Groth16Point;
};

const verificationKeys = new Map<string, Promise<Record<string, unknown>>>();

function scalarBytes(value: string | number | bigint): Uint8Array {
  const scalar = BigInt(value);
  const encoded = scalar.toString(16).padStart(64, "0");
  if (scalar < 0n || encoded.length !== 64) throw new Error("Groth16 coordinate is invalid.");
  return Uint8Array.from(encoded.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function pointScalar(point: Groth16Point, index: number): string | number | bigint {
  const value = point[index];
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("Groth16 proof point is malformed.");
  }
  return value;
}

function encodeProof(value: unknown): Uint8Array {
  const proof = value as Groth16Proof;
  if (
    proof.protocol !== "groth16" ||
    proof.curve !== "bn128" ||
    !proof.pi_a || !proof.pi_b || !proof.pi_c ||
    !Array.isArray(proof.pi_b[0]) || !Array.isArray(proof.pi_b[1])
  ) throw new Error("Prover returned an incompatible Groth16 proof.");
  const b0 = proof.pi_b[0];
  const b1 = proof.pi_b[1];
  const fields = [
    pointScalar(proof.pi_a, 0), pointScalar(proof.pi_a, 1),
    pointScalar(b0, 1), pointScalar(b0, 0),
    pointScalar(b1, 1), pointScalar(b1, 0),
    pointScalar(proof.pi_c, 0), pointScalar(proof.pi_c, 1),
  ];
  const encoded = new Uint8Array(256);
  fields.forEach((field, index) => encoded.set(scalarBytes(field), index * 32));
  return encoded;
}

async function verificationKey(url: string): Promise<Record<string, unknown>> {
  let pending = verificationKeys.get(url);
  if (!pending) {
    pending = fetch(url, { cache: "force-cache" }).then(async (response) => {
      if (!response.ok) throw new Error("Payment verification key is unavailable.");
      return await response.json() as Record<string, unknown>;
    }).catch((error) => {
      verificationKeys.delete(url);
      throw error;
    });
    verificationKeys.set(url, pending);
  }
  return pending;
}

export async function provePayment(input: {
  deployment: PaymentDeployment;
  circuit: string;
  witness: Record<string, unknown>;
  expected: Record<(typeof PAYMENT_PUBLIC_SIGNALS)[number], bigint>;
}): Promise<Uint8Array> {
  const artifact = input.deployment.circuits.find((candidate) => candidate.name === input.circuit);
  if (!artifact) throw new Error(`Payment circuit ${input.circuit} is unavailable.`);
  const verificationKeyUrl = artifact.provingKeyUrl.replace(/\.zkey$/u, ".vk.json");
  const vkey = await verificationKey(verificationKeyUrl);
  const result = await snarkjs.groth16.fullProve(input.witness, artifact.wasmUrl, artifact.provingKeyUrl);
  if (!(await snarkjs.groth16.verify(vkey, result.publicSignals, result.proof))) {
    throw new Error("Payment proof failed local verification.");
  }
  const expected = PAYMENT_PUBLIC_SIGNALS.map((name) => input.expected[name].toString());
  if (expected.some((value, index) => BigInt(result.publicSignals[index]).toString() !== value)) {
    throw new Error("Payment proof does not match the prepared transaction.");
  }
  return encodeProof(result.proof);
}
