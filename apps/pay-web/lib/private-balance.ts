import { Address, contract, rpc } from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  MorosPaymentClient,
  PaymentOutputScanner,
  type PaymentDeployment,
} from "@moros/payments-client";
import {
  decryptPaymentOutput,
  derivePaymentIdentityMaterial,
} from "./payment-identity";

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const PAYMENT_NOTE_DOMAIN_TAG = 1101n;
const NOTE_NULLIFIER_TAG = 1004n;
const NOTE_NULLIFIER_DOMAIN = 1n;
const PAYMENT_NOTE_PURPOSE = 1n;
const PAYMENT_ENVELOPE_BYTES = 480;
const MAX_SCAN_OUTPUTS = 5_000;

type IndexedPaymentOutput = {
  outputIndex: number;
  leafIndex: number;
  commitment: string;
  encryptedOutput: string;
  actionId: string;
};

type RecoveredPaymentNote = {
  amountAtomic: bigint;
  nullifier: bigint;
};

export type PrivateBalanceSnapshot = {
  spendableAtomic: bigint;
  scannedOutputs: number;
  ownedNotes: number;
  spendableNotes: number;
};

type ContractMethodResult<T> = { result: T };
type DynamicContractClient = {
  [method: string]: unknown;
};

const readClientCache = new Map<string, Promise<DynamicContractClient>>();

function bigIntFromBytes(value: Uint8Array, endian: "be" | "le" = "be"): bigint {
  const bytes = endian === "le" ? Uint8Array.from(value).reverse() : value;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex || "0"}`);
}

export function fieldToBytes(value: bigint): Uint8Array {
  if (value < 0n || value >= FIELD) throw new Error("Payment field is not canonical.");
  const encoded = value.toString(16).padStart(64, "0");
  return Uint8Array.from(encoded.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function hexToBytes(value: string, length: number, label: string): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, "u").test(value)) {
    throw new Error(`Payment ${label} is invalid.`);
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function digest(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer));
}

function bytes32Limbs(value: Uint8Array): [bigint, bigint] {
  if (value.length !== 32) throw new Error("Payment domain input is invalid.");
  return [bigIntFromBytes(value.slice(0, 16)), bigIntFromBytes(value.slice(16))];
}

async function addressDigest(value: string): Promise<Uint8Array> {
  const encoded = new Address(value).toScVal().toXDR();
  return digest(new Uint8Array(encoded));
}

export async function paymentNoteDomain(
  deployment: Pick<PaymentDeployment, "networkPassphrase" | "vault" | "usdcContract">,
): Promise<bigint> {
  const [network, vault, token] = await Promise.all([
    digest(new TextEncoder().encode(deployment.networkPassphrase)),
    addressDigest(deployment.vault),
    addressDigest(deployment.usdcContract),
  ]);
  return poseidon2Hash([
    PAYMENT_NOTE_DOMAIN_TAG,
    ...bytes32Limbs(network),
    ...bytes32Limbs(vault),
    ...bytes32Limbs(token),
    1n,
  ]);
}

export function paymentNoteNullifier(input: {
  noteDomain: bigint;
  commitment: Uint8Array;
  noteId: Uint8Array;
  spendSecret: Uint8Array;
}): bigint {
  return poseidon2Hash([
    NOTE_NULLIFIER_TAG,
    input.noteDomain,
    NOTE_NULLIFIER_DOMAIN,
    bigIntFromBytes(input.commitment),
    bigIntFromBytes(input.spendSecret, "le"),
    bigIntFromBytes(input.noteId),
  ]);
}

function indexedOutput(value: unknown): IndexedPaymentOutput {
  if (!value || typeof value !== "object") throw new Error("Payment output is invalid.");
  const output = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(output.outputIndex) ||
    Number(output.outputIndex) < 0 ||
    Number(output.outputIndex) > 3 ||
    !Number.isSafeInteger(output.leafIndex) ||
    Number(output.leafIndex) < 0 ||
    typeof output.commitment !== "string" ||
    typeof output.encryptedOutput !== "string" ||
    typeof output.actionId !== "string"
  ) {
    throw new Error("Payment output is invalid.");
  }
  const commitment = BigInt(output.commitment);
  if (commitment < 0n || commitment >= FIELD) throw new Error("Payment commitment is invalid.");
  hexToBytes(output.encryptedOutput, PAYMENT_ENVELOPE_BYTES, "envelope");
  hexToBytes(output.actionId, 32, "action identifier");
  return output as IndexedPaymentOutput;
}

function isUnownedOutput(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes("private note envelope authentication failed");
}

async function readClient(
  endpoint: string,
  deployment: PaymentDeployment,
): Promise<DynamicContractClient> {
  const key = `${endpoint}:${deployment.vault}`;
  let pending = readClientCache.get(key);
  if (!pending) {
    pending = (async () => {
      const server = new rpc.Server(endpoint, { allowHttp: deployment.environment === "local" });
      const wasm = await server.getContractWasmByContractId(deployment.vault);
      return contract.Client.fromWasm(wasm, {
        contractId: deployment.vault,
        networkPassphrase: deployment.networkPassphrase,
        rpcUrl: endpoint,
        allowHttp: deployment.environment === "local",
      }) as unknown as DynamicContractClient;
    })().catch((error) => {
      readClientCache.delete(key);
      throw error;
    });
    readClientCache.set(key, pending);
  }
  return pending;
}

export async function nullifierSpent(
  deployment: PaymentDeployment,
  nullifier: bigint,
): Promise<boolean> {
  let lastError: unknown;
  for (const endpoint of deployment.rpcUrls) {
    try {
      const client = await readClient(endpoint, deployment);
      const method = client.nullifier_spent;
      if (typeof method !== "function") throw new Error("Payment vault read method is unavailable.");
      const call = await method.call(client, { nullifier }) as ContractMethodResult<unknown>;
      if (typeof call.result !== "boolean") throw new Error("Payment vault returned an invalid nullifier state.");
      return call.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not verify private balance on Stellar: ${lastError instanceof Error ? lastError.message : "all RPC providers failed"}`,
  );
}

export async function scanPrivatePaymentBalance(input: {
  phrase: string;
  deployment: PaymentDeployment;
  signal?: AbortSignal;
  readSpent?: (nullifier: bigint) => Promise<boolean>;
  client?: Pick<MorosPaymentClient, "outputs">;
}): Promise<PrivateBalanceSnapshot> {
  const identity = await derivePaymentIdentityMaterial(input.phrase, input.deployment);
  const domain = await paymentNoteDomain(input.deployment);
  const client = input.client ?? new MorosPaymentClient({ deployment: input.deployment });
  const scanner = new PaymentOutputScanner({
    client,
    deployment: input.deployment,
  });
  try {
    const result = await scanner.scan({
      signal: input.signal,
      pageSize: 100,
      decrypt: async (raw): Promise<RecoveredPaymentNote | null> => {
        const output = indexedOutput(raw);
        let note;
        try {
          note = await decryptPaymentOutput({
            envelope: hexToBytes(output.encryptedOutput, PAYMENT_ENVELOPE_BYTES, "envelope"),
            viewingSecret: identity.viewingSecret,
            paymentCode: identity.paymentCode,
            noteDomain: fieldToBytes(domain),
            expectedCommitment: fieldToBytes(BigInt(output.commitment)),
          });
        } catch (error) {
          if (isUnownedOutput(error)) return null;
          throw error;
        }
        try {
          if (note.purpose !== PAYMENT_NOTE_PURPOSE) throw new Error("Payment note has an unsupported purpose.");
          const amountAtomic = BigInt(note.amount_atomic);
          if (amountAtomic < 0n) throw new Error("Payment note amount is invalid.");
          if (amountAtomic === 0n) return null;
          return {
            amountAtomic,
            nullifier: paymentNoteNullifier({
              noteDomain: domain,
              commitment: note.commitment,
              noteId: note.note_id,
              spendSecret: identity.spendSecret,
            }),
          };
        } finally {
          note.free();
        }
      },
    });
    if (result.scanned > MAX_SCAN_OUTPUTS) throw new Error("Payment output scan limit exceeded.");
    const recovered = result.notes.map(({ note }) => note as RecoveredPaymentNote);
    const readSpent = input.readSpent ?? ((value) => nullifierSpent(input.deployment, value));
    const spent = new Map<bigint, boolean>();
    for (let offset = 0; offset < recovered.length; offset += 8) {
      const batch = recovered.slice(offset, offset + 8);
      const states = await Promise.all(batch.map(async (note) => {
        const known = spent.get(note.nullifier);
        if (known !== undefined) return known;
        const value = await readSpent(note.nullifier);
        spent.set(note.nullifier, value);
        return value;
      }));
      batch.forEach((note, index) => spent.set(note.nullifier, states[index]));
    }
    const spendable = recovered.filter((note) => !spent.get(note.nullifier));
    return {
      spendableAtomic: spendable.reduce((total, note) => total + note.amountAtomic, 0n),
      scannedOutputs: result.scanned,
      ownedNotes: recovered.length,
      spendableNotes: spendable.length,
    };
  } finally {
    identity.spendSecret.fill(0);
    identity.viewingSecret.fill(0);
  }
}
