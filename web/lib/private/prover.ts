"use client";

import * as snarkjs from "snarkjs";
import {
  getPrivateConfig,
  privateArtifactUrl,
  type PrivateDeploymentConfig,
} from "./client";

type Groth16Point = Array<string | number | bigint | Groth16Point>;

type Groth16Proof = {
  protocol?: unknown;
  curve?: unknown;
  pi_a?: Groth16Point;
  pi_b?: Groth16Point;
  pi_c?: Groth16Point;
};

type PrivateArtifactManifest = {
  format: number;
  network: string;
  mainnet_ready: boolean;
  curve: string;
  proof_system: string;
  circuits: Array<{
    name: string;
    prover: string;
    artifacts: {
      wasm: string;
      proving_key: string;
      verification_key: string;
    };
  }>;
};

let manifestPromise: Promise<PrivateArtifactManifest> | null = null;

function scalarBytes(value: string | number | bigint): Uint8Array {
  const scalar = BigInt(value);
  if (scalar < 0n) throw new Error("Groth16 coordinate is negative");
  const encoded = scalar.toString(16).padStart(64, "0");
  if (encoded.length !== 64) throw new Error("Groth16 coordinate is too large");
  return Uint8Array.from(encoded.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16)
  );
}

function pointScalar(point: Groth16Point, index: number): string | number | bigint {
  const value = point[index];
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error("Groth16 proof point is malformed");
  }
  return value;
}

function encodeProof(value: unknown): Uint8Array {
  const proof = value as Groth16Proof;
  if (
    proof.protocol !== "groth16" ||
    proof.curve !== "bn128" ||
    !proof.pi_a ||
    !proof.pi_b ||
    !proof.pi_c ||
    !Array.isArray(proof.pi_b[0]) ||
    !Array.isArray(proof.pi_b[1])
  ) {
    throw new Error("Prover returned an incompatible Groth16 proof");
  }
  const b0 = proof.pi_b[0];
  const b1 = proof.pi_b[1];
  const fields = [
    pointScalar(proof.pi_a, 0),
    pointScalar(proof.pi_a, 1),
    pointScalar(b0, 1),
    pointScalar(b0, 0),
    pointScalar(b1, 1),
    pointScalar(b1, 0),
    pointScalar(proof.pi_c, 0),
    pointScalar(proof.pi_c, 1),
  ];
  const encoded = new Uint8Array(256);
  fields.forEach((field, index) => encoded.set(scalarBytes(field), index * 32));
  return encoded;
}

async function privateManifest(
  config: PrivateDeploymentConfig,
): Promise<PrivateArtifactManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(privateArtifactUrl(config, "manifest.json"), {
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Private proving manifest is unavailable");
      const manifest = await response.json() as PrivateArtifactManifest;
      if (
        manifest.format !== 1 ||
        manifest.network !== "testnet" ||
        manifest.mainnet_ready !== false ||
        manifest.curve !== "bn254" ||
        manifest.proof_system !== "groth16"
      ) {
        throw new Error("Private proving manifest is incompatible");
      }
      return manifest;
    }).catch((error) => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

export async function provePrivateAction(
  circuitName: string,
  input: Record<string, unknown>,
): Promise<{ proof: Uint8Array; publicSignals: bigint[] }> {
  const config = await getPrivateConfig();
  const manifest = await privateManifest(config);
  const circuit = manifest.circuits.find((entry) =>
    entry.name === circuitName && entry.prover === "browser"
  );
  if (!circuit) throw new Error(`Private circuit ${circuitName} is unavailable`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    privateArtifactUrl(config, circuit.artifacts.wasm),
    privateArtifactUrl(config, circuit.artifacts.proving_key),
  );
  const verificationResponse = await fetch(
    privateArtifactUrl(config, circuit.artifacts.verification_key),
    { cache: "force-cache" },
  );
  if (!verificationResponse.ok) {
    throw new Error("Private verification key is unavailable");
  }
  const verificationKey = await verificationResponse.json() as Record<string, unknown>;
  if (!(await snarkjs.groth16.verify(verificationKey, publicSignals, proof))) {
    throw new Error("Private proof failed local verification");
  }
  return {
    proof: encodeProof(proof),
    publicSignals: publicSignals.map(BigInt),
  };
}
