import { Address, contract, rpc } from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  PaymentOutputScanner,
  type MorosPaymentClient,
  type PaymentDeployment,
} from "@moros/payments-client";
import { createPaymentClient } from "./payment-client";
import {
  decryptPaymentOutput,
  derivePaymentIdentityMaterial,
  type PaymentIdentityMaterial,
} from "./payment-identity";
import {
  noteNullifier,
  selectPaymentNotes,
  type PaymentNote,
} from "./payment-protocol";

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

type RecoveredPaymentNote = PaymentNote;

export type PrivateBalanceSnapshot = {
  spendableAtomic: bigint;
  scannedOutputs: number;
  ownedNotes: number;
  spendableNotes: number;
};

export type PreparedPrivateSpend = {
  commitments: bigint[];
  notes: PaymentNote[];
  totalAtomic: bigint;
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

export interface PrivateBalanceSession {
  refresh(signal?: AbortSignal): Promise<PrivateBalanceSnapshot>;
  prepareSpend(requiredAtomic: bigint, signal?: AbortSignal): Promise<PreparedPrivateSpend>;
  expand(maximumChildIndex: number): Promise<void>;
  dispose(): void;
}

type BalanceSessionInput = {
  phrase: string;
  deployment: PaymentDeployment;
  maximumChildIndex?: number;
  readSpent?: (nullifier: bigint) => Promise<boolean>;
  client?: Pick<MorosPaymentClient, "outputs">;
};

class BrowserPrivateBalanceSession implements PrivateBalanceSession {
  private readonly phrase: string;
  private readonly deployment: PaymentDeployment;
  private readonly domain: bigint;
  private readonly identities: PaymentIdentityMaterial[];
  private readonly scanner: PaymentOutputScanner;
  private readonly readSpent: (nullifier: bigint) => Promise<boolean>;
  private readonly recovered = new Map<string, RecoveredPaymentNote>();
  private readonly unowned = new Map<string, ReturnType<typeof indexedOutput>>();
  private readonly commitments: bigint[] = [];
  private spendable: RecoveredPaymentNote[] = [];
  private disposed = false;
  private refreshPending: Promise<PrivateBalanceSnapshot> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(input: {
    phrase: string;
    deployment: PaymentDeployment;
    domain: bigint;
    identities: PaymentIdentityMaterial[];
    scanner: PaymentOutputScanner;
    readSpent: (nullifier: bigint) => Promise<boolean>;
  }) {
    this.phrase = input.phrase;
    this.deployment = input.deployment;
    this.domain = input.domain;
    this.identities = input.identities;
    this.scanner = input.scanner;
    this.readSpent = input.readSpent;
  }

  async expand(maximumChildIndex: number): Promise<void> {
    return this.enqueue(() => this.expandCurrent(maximumChildIndex));
  }

  private async expandCurrent(maximumChildIndex: number): Promise<void> {
    if (this.disposed) throw new Error("Private balance session is closed.");
    if (!Number.isSafeInteger(maximumChildIndex) || maximumChildIndex < 0 || maximumChildIndex > 999) {
      throw new Error("Private receive identity range is invalid.");
    }
    const added: PaymentIdentityMaterial[] = [];
    for (let childIndex = this.identities.length; childIndex <= maximumChildIndex; childIndex += 1) {
      const identity = await derivePaymentIdentityMaterial(
        this.phrase,
        this.deployment,
        BigInt(childIndex),
      );
      this.identities.push(identity);
      added.push(identity);
    }
    for (const [commitment, output] of this.unowned) {
      const recovered = await this.recoverOutput(output, added);
      if (recovered === undefined) continue;
      this.unowned.delete(commitment);
      if (recovered) this.recovered.set(recovered.nullifier.toString(), recovered);
    }
  }

  refresh(signal?: AbortSignal): Promise<PrivateBalanceSnapshot> {
    if (this.disposed) return Promise.reject(new Error("Private balance session is closed."));
    if (!this.refreshPending) {
      this.refreshPending = this.enqueue(() => this.refreshCurrent(signal)).finally(() => {
        this.refreshPending = null;
      });
    }
    return this.refreshPending;
  }

  async prepareSpend(requiredAtomic: bigint, signal?: AbortSignal): Promise<PreparedPrivateSpend> {
    return this.enqueue(async () => {
      await this.refreshCurrent(signal);
      const notes = selectPaymentNotes(this.spendable, requiredAtomic);
      return {
        commitments: [...this.commitments],
        notes,
        totalAtomic: notes.reduce((total, note) => total + note.amount, 0n),
      };
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async refreshCurrent(signal?: AbortSignal): Promise<PrivateBalanceSnapshot> {
    const result = await this.scanner.scan({
      signal,
      pageSize: 100,
      decrypt: async (raw): Promise<RecoveredPaymentNote | null> => {
        const output = indexedOutput(raw);
        const commitment = BigInt(output.commitment);
        if (this.commitments[output.leafIndex] !== undefined && this.commitments[output.leafIndex] !== commitment) {
          throw new Error("Payment commitment history changed unexpectedly.");
        }
        this.commitments[output.leafIndex] = commitment;
        const recovered = await this.recoverOutput(output, this.identities);
        if (recovered === undefined) {
          this.unowned.set(output.commitment, output);
          return null;
        }
        this.unowned.delete(output.commitment);
        return recovered;
      },
    });
    if (result.scanned > MAX_SCAN_OUTPUTS) throw new Error("Payment output scan limit exceeded.");
    for (const { note } of result.notes) {
      const recovered = note as RecoveredPaymentNote;
      this.recovered.set(recovered.nullifier.toString(), recovered);
    }
    const recovered = [...this.recovered.values()];
    const spent = new Map<bigint, boolean>();
    for (let offset = 0; offset < recovered.length; offset += 8) {
      if (signal?.aborted) throw signal.reason || new Error("Payment balance refresh aborted.");
      const batch = recovered.slice(offset, offset + 8);
      const states = await Promise.all(batch.map((note) => this.readSpent(note.nullifier)));
      batch.forEach((note, index) => spent.set(note.nullifier, states[index]));
    }
    const spendable = recovered.filter((note) => !spent.get(note.nullifier));
    this.spendable = spendable;
    return {
      spendableAtomic: spendable.reduce((total, note) => total + note.amount, 0n),
      scannedOutputs: result.checkpoint,
      ownedNotes: recovered.length,
      spendableNotes: spendable.length,
    };
  }

  private async recoverOutput(
    output: ReturnType<typeof indexedOutput>,
    identities: PaymentIdentityMaterial[],
  ): Promise<RecoveredPaymentNote | null | undefined> {
    for (const identity of identities) {
      let note;
      try {
        note = await decryptPaymentOutput({
          envelope: hexToBytes(output.encryptedOutput, PAYMENT_ENVELOPE_BYTES, "envelope"),
          viewingSecret: identity.viewingSecret,
          paymentCode: identity.paymentCode,
          noteDomain: fieldToBytes(this.domain),
          expectedCommitment: fieldToBytes(BigInt(output.commitment)),
        });
      } catch (error) {
        if (isUnownedOutput(error)) continue;
        throw error;
      }
      try {
        if (note.purpose !== PAYMENT_NOTE_PURPOSE) throw new Error("Payment note has an unsupported purpose.");
        const amount = BigInt(note.amount_atomic);
        if (amount < 0n) throw new Error("Payment note amount is invalid.");
        if (amount === 0n) return null;
        const privateData = note.private_data;
        const viewingPublicKey = note.viewing_public_key;
        const spendSecret = bigIntFromBytes(identity.spendSecret, "le");
        const recoveredNote: PaymentNote = {
          purpose: BigInt(note.purpose),
          amount,
          spendSecret,
          viewingPublicKey: [
            bigIntFromBytes(viewingPublicKey.slice(0, 32)),
            bigIntFromBytes(viewingPublicKey.slice(32, 64)),
          ],
          noteId: bigIntFromBytes(note.note_id),
          payloadHash: bigIntFromBytes(note.payload_hash),
          privateData: [
            bigIntFromBytes(privateData.slice(0, 32)),
            bigIntFromBytes(privateData.slice(32, 64)),
          ],
          blinding: bigIntFromBytes(note.blinding),
          commitment: BigInt(output.commitment),
          nullifier: 0n,
          leafIndex: output.leafIndex,
        };
        recoveredNote.nullifier = noteNullifier(recoveredNote, this.domain);
        return recoveredNote;
      } finally {
        note.free();
      }
    }
    return undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const identity of this.identities) {
      identity.spendSecret.fill(0);
      identity.viewingSecret.fill(0);
    }
    this.identities.length = 0;
    this.recovered.clear();
    this.unowned.clear();
    this.commitments.length = 0;
    this.spendable = [];
  }
}

export async function createPrivateBalanceSession(input: BalanceSessionInput): Promise<PrivateBalanceSession> {
  const maximumChildIndex = input.maximumChildIndex ?? 0;
  if (!Number.isSafeInteger(maximumChildIndex) || maximumChildIndex < 0 || maximumChildIndex > 999) {
    throw new Error("Private receive identity range is invalid.");
  }
  const identities: PaymentIdentityMaterial[] = [];
  try {
    for (let childIndex = 0; childIndex <= maximumChildIndex; childIndex += 1) {
      identities.push(await derivePaymentIdentityMaterial(input.phrase, input.deployment, BigInt(childIndex)));
    }
  } catch (error) {
    for (const identity of identities) {
      identity.spendSecret.fill(0);
      identity.viewingSecret.fill(0);
    }
    throw error;
  }
  const domain = await paymentNoteDomain(input.deployment);
  const client = input.client ?? createPaymentClient(input.deployment);
  const scanner = new PaymentOutputScanner({
    client,
    deployment: input.deployment,
  });
  return new BrowserPrivateBalanceSession({
    phrase: input.phrase,
    deployment: input.deployment,
    domain,
    identities,
    scanner,
    readSpent: input.readSpent ?? ((value) => nullifierSpent(input.deployment, value)),
  });
}

export async function scanPrivatePaymentBalance(input: BalanceSessionInput & {
  signal?: AbortSignal;
}): Promise<PrivateBalanceSnapshot> {
  const session = await createPrivateBalanceSession(input);
  try {
    return await session.refresh(input.signal);
  } finally {
    session.dispose();
  }
}
