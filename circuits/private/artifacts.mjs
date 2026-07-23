import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ACTION_PUBLIC_SIGNALS = [
  "action",
  "contextDigest",
  "membershipRoot",
  "appendRoot",
  "newRoot",
  "nullifierCount",
  "nullifier0",
  "nullifier1",
  "outputCommitment0",
  "outputCommitment1",
  "outputEnvelopeHash0",
  "outputEnvelopeHash1",
  "firstLeafIndex",
  "publicAmountSign",
  "publicAmountMagnitude",
];

export const EXIT_MATCH_PUBLIC_SIGNALS = [
  "action",
  "contextDigest",
  "membershipRoot",
  "appendRoot",
  "newRoot",
  "nullifierCount",
  "nullifier0",
  "nullifier1",
  "nullifier2",
  "outputCommitment0",
  "outputCommitment1",
  "outputCommitment2",
  "outputCommitment3",
  "outputEnvelopeHash0",
  "outputEnvelopeHash1",
  "outputEnvelopeHash2",
  "outputEnvelopeHash3",
  "firstLeafIndex",
  "publicAmountSign",
  "publicAmountMagnitude",
];

export const BATCH_PUBLIC_SIGNALS = [
  "networkDomainHigh",
  "networkDomainLow",
  "vaultHigh",
  "vaultLow",
  "marketHigh",
  "marketLow",
  "epoch",
  "acceptedRoot",
  "acceptedCount",
  "firstSequence",
  "lastSequence",
  "committeeEpoch",
  "committeeConfigHashHigh",
  "committeeConfigHashLow",
  "committeePublicKeyX",
  "committeePublicKeyY",
  "aggregateYesCiphertextC1X",
  "aggregateYesCiphertextC1Y",
  "aggregateYesCiphertextC2X",
  "aggregateYesCiphertextC2Y",
  "aggregateNoCiphertextC1X",
  "aggregateNoCiphertextC1Y",
  "aggregateNoCiphertextC2X",
  "aggregateNoCiphertextC2Y",
  "decryptionProofHashHigh",
  "decryptionProofHashLow",
  "committeeStatementHashHigh",
  "committeeStatementHashLow",
  "allocationRoot",
  "includedRoot",
  "lotSize",
  "stateVersion",
  "batchSize",
  "yesCount",
  "noCount",
  "preYesPrice",
  "postYesPrice",
  "yesPrice",
  "noPrice",
  "aggregateMarketCharge",
  "yesMarketCost",
  "noMarketCost",
  "yesChargePerPosition",
  "noChargePerPosition",
  "roundingContribution",
  "feePerPosition",
  "feeEscrow",
  "conditionalLpFee",
  "conditionalProtocolFee",
];

export const CIRCUITS = [
  ["deposit", 0, ACTION_PUBLIC_SIGNALS, "browser"],
  ["transfer", 1, ACTION_PUBLIC_SIGNALS, "browser"],
  ["withdraw", 2, ACTION_PUBLIC_SIGNALS, "browser"],
  ["order", 3, ACTION_PUBLIC_SIGNALS, "browser"],
  ["claim", 4, ACTION_PUBLIC_SIGNALS, "browser"],
  ["refund", 5, ACTION_PUBLIC_SIGNALS, "browser"],
  ["liquidity_fund", 6, ACTION_PUBLIC_SIGNALS, "browser"],
  ["liquidity_exit", 7, ACTION_PUBLIC_SIGNALS, "browser"],
  ["liquidity_redeem", 8, ACTION_PUBLIC_SIGNALS, "browser"],
  ["execution_change", 9, ACTION_PUBLIC_SIGNALS, "browser"],
  ["treasury", 10, ACTION_PUBLIC_SIGNALS, "service"],
  ["exit_request", 11, ACTION_PUBLIC_SIGNALS, "browser"],
  ["exit_cancel", 12, ACTION_PUBLIC_SIGNALS, "browser"],
  ["exit_match", 13, EXIT_MATCH_PUBLIC_SIGNALS, "browser"],
  ["batch", 14, BATCH_PUBLIC_SIGNALS, "service"],
].map(([name, code, publicSignals, prover]) => ({
  name,
  code,
  variant: name
    .split("_")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(""),
  publicSignals,
  prover,
}));

const BASE_FIELD =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function schema(circuit) {
  return {
    circuit: circuit.name,
    circuitCode: circuit.code,
    curve: "bn254",
    proofSystem: "groth16",
    publicSignals: circuit.publicSignals,
  };
}

export function schemaHash(circuit) {
  return sha256(canonicalJson(schema(circuit)));
}

export function scalarBytes(value) {
  const scalar = BigInt(value);
  if (scalar < 0n || scalar >= BASE_FIELD) {
    throw new Error("BN254 coordinate is outside the canonical base field");
  }
  return Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
}

export function encodeG1(point) {
  if (!Array.isArray(point) || point.length < 2) {
    throw new Error("invalid snarkjs G1 point");
  }
  return Buffer.concat([scalarBytes(point[0]), scalarBytes(point[1])]);
}

export function encodeG2(point) {
  if (
    !Array.isArray(point) ||
    point.length < 2 ||
    !Array.isArray(point[0]) ||
    !Array.isArray(point[1]) ||
    point[0].length < 2 ||
    point[1].length < 2
  ) {
    throw new Error("invalid snarkjs G2 point");
  }
  return Buffer.concat([
    scalarBytes(point[0][1]),
    scalarBytes(point[0][0]),
    scalarBytes(point[1][1]),
    scalarBytes(point[1][0]),
  ]);
}

export function verificationKeyBytes(vkey, expectedPublicInputs) {
  if (
    vkey.protocol !== "groth16" ||
    vkey.curve !== "bn128" ||
    Number(vkey.nPublic) !== expectedPublicInputs ||
    !Array.isArray(vkey.IC) ||
    vkey.IC.length !== expectedPublicInputs + 1
  ) {
    throw new Error("verification key does not match the circuit schema");
  }
  return {
    alpha: encodeG1(vkey.vk_alpha_1),
    beta: encodeG2(vkey.vk_beta_2),
    gamma: encodeG2(vkey.vk_gamma_2),
    delta: encodeG2(vkey.vk_delta_2),
    ic: vkey.IC.map(encodeG1),
  };
}

export function proofBytes(proof) {
  if (proof.protocol !== "groth16" || proof.curve !== "bn128") {
    throw new Error("proof is not BN254 Groth16");
  }
  const encoded = Buffer.concat([
    encodeG1(proof.pi_a),
    encodeG2(proof.pi_b),
    encodeG1(proof.pi_c),
  ]);
  if (encoded.length !== 256) {
    throw new Error("invalid encoded Groth16 proof length");
  }
  return encoded;
}

export function keyPayload(circuit, vkey) {
  const key = verificationKeyBytes(vkey, circuit.publicSignals.length);
  return {
    circuit: { tag: circuit.variant },
    schema_hash: Buffer.from(schemaHash(circuit), "hex"),
    verification_key: key,
  };
}

export function keyPayloadJson(circuit, vkey) {
  const payload = keyPayload(circuit, vkey);
  return {
    circuit: payload.circuit,
    schema_hash: payload.schema_hash.toString("hex"),
    verification_key: {
      alpha: payload.verification_key.alpha.toString("hex"),
      beta: payload.verification_key.beta.toString("hex"),
      gamma: payload.verification_key.gamma.toString("hex"),
      delta: payload.verification_key.delta.toString("hex"),
      ic: payload.verification_key.ic.map((point) => point.toString("hex")),
    },
  };
}

export function keyPayloadFromJson(value) {
  return {
    circuit: value.circuit,
    schema_hash: Buffer.from(value.schema_hash, "hex"),
    verification_key: {
      alpha: Buffer.from(value.verification_key.alpha, "hex"),
      beta: Buffer.from(value.verification_key.beta, "hex"),
      gamma: Buffer.from(value.verification_key.gamma, "hex"),
      delta: Buffer.from(value.verification_key.delta, "hex"),
      ic: value.verification_key.ic.map((point) => Buffer.from(point, "hex")),
    },
  };
}

export function parseR1csInfo(output) {
  const normalized = output.replace(/\u001b\[[0-9;]*m/g, "");
  const read = (label) => {
    const match = normalized.match(new RegExp(`${label}:\\s+(\\d+)`));
    if (!match) throw new Error(`missing ${label} in snarkjs R1CS output`);
    return Number(match[1]);
  };
  return {
    wires: read("# of Wires"),
    constraints: read("# of Constraints"),
    privateInputs: read("# of Private Inputs"),
    publicInputs: read("# of Public Inputs"),
    labels: read("# of Labels"),
    outputs: read("# of Outputs"),
  };
}
