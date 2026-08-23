"use client";

import { getNetworkDetails, signTransaction } from "@stellar/freighter-api";
import {
  TransactionBuilder,
  contract,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { MorosPaymentClient, type PaymentDeployment } from "@moros/payments-client";
import type { PreparedPrivateSpend } from "./private-balance";
import {
  contextFields,
  createPaymentAttachment,
  createPaymentOutput,
  merkleTree,
  noteWitness,
  outputWitness,
  paymentCodeForIdentity,
  paymentNoteDomain,
  publicFields,
  randomField,
  relayQuoteDigest,
  transition,
  type PaymentIdentityPublic,
} from "./payment-protocol";
import { provePayment } from "./payment-prover";

type DynamicContractClient = {
  spec: contract.Spec;
  [method: string]: unknown;
};

type ContractMethodResult<T> = {
  result: T;
  signAndSend(): Promise<{ sendTransactionResponse?: { hash?: string }; hash?: string }>;
};

type VaultInfo = {
  current_root: bigint;
  fee: {
    epoch: bigint;
    protocol_fee: bigint;
    protocol_identity: {
      spend_public_key: bigint;
      viewing_public_key_x: bigint;
      viewing_public_key_y: bigint;
    };
  };
  network_domain: Uint8Array;
  next_leaf_index: number;
  paused: boolean;
  verifier_domain: Uint8Array;
};

type RelayQuote = {
  xdr: string;
  quoteId: string;
  signingKey: string;
  paymentIdentity: PaymentIdentityPublic;
  fee: string;
  expiry: string | number;
};

export type PaymentActionProgress =
  | "preparing"
  | "proving"
  | "approving"
  | "submitting"
  | "confirming";

const clientCache = new Map<string, Promise<DynamicContractClient>>();

function identity(value: VaultInfo["fee"]["protocol_identity"] | PaymentIdentityPublic): PaymentIdentityPublic {
  if ("spend_public_key" in value) {
    return {
      spendPublicKey: BigInt(value.spend_public_key),
      viewingPublicKeyX: BigInt(value.viewing_public_key_x),
      viewingPublicKeyY: BigInt(value.viewing_public_key_y),
    };
  }
  return {
    spendPublicKey: BigInt(value.spendPublicKey),
    viewingPublicKeyX: BigInt(value.viewingPublicKeyX),
    viewingPublicKeyY: BigInt(value.viewingPublicKeyY),
  };
}

async function contractClient(deployment: PaymentDeployment, endpoint: string): Promise<DynamicContractClient> {
  const key = `${endpoint}:${deployment.vault}`;
  let pending = clientCache.get(key);
  if (!pending) {
    pending = (async () => {
      const server = new rpc.Server(endpoint, { allowHttp: deployment.environment === "local" });
      const wasm = await server.getContractWasmByContractId(deployment.vault);
      return await contract.Client.fromWasm(wasm, {
        contractId: deployment.vault,
        networkPassphrase: deployment.networkPassphrase,
        rpcUrl: endpoint,
        allowHttp: deployment.environment === "local",
      }) as unknown as DynamicContractClient;
    })().catch((error) => {
      clientCache.delete(key);
      throw error;
    });
    clientCache.set(key, pending);
  }
  return pending;
}

async function readVault(deployment: PaymentDeployment): Promise<{ client: DynamicContractClient; info: VaultInfo }> {
  let lastError: unknown;
  for (const endpoint of deployment.rpcUrls) {
    try {
      const client = await contractClient(deployment, endpoint);
      const method = client.info;
      if (typeof method !== "function") throw new Error("Payment vault info method is unavailable.");
      const response = await method.call(client) as ContractMethodResult<VaultInfo>;
      if (response.result.paused) throw new Error("Private payments are temporarily paused.");
      return { client, info: response.result };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not read the payment vault: ${lastError instanceof Error ? lastError.message : "all RPC providers failed"}`);
}

function actionId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function circuit(inputCount: number, action: "transfer" | "withdraw") {
  const suffix = inputCount === 1 ? "one" : inputCount === 2 ? "two" : inputCount === 4 ? "four" : null;
  if (!suffix) throw new Error("Private payment requires one, two, or four input notes.");
  const prefix = action === "transfer" ? "Transfer" : "Withdraw";
  const title = suffix[0].toUpperCase() + suffix.slice(1);
  return { name: `${action}_${suffix}`, tag: `${prefix}${title}` };
}

function quoteNative(quote: RelayQuote) {
  return scValToNative(xdr.ScVal.fromXDR(quote.xdr, "base64"));
}

function relayHash(result: unknown): string {
  if (!result || typeof result !== "object" || !("hash" in result) || typeof result.hash !== "string") {
    throw new Error("Payment relay did not return a transaction hash.");
  }
  return result.hash;
}

async function quoteFor(
  deployment: PaymentDeployment,
  id: Uint8Array,
  expiry: number,
): Promise<{ client: MorosPaymentClient; quote: RelayQuote }> {
  const client = new MorosPaymentClient({ deployment, timeoutMs: 20_000, attempts: 2 });
  const quote = await client.quote({ actionId: id, actionExpiry: expiry }) as RelayQuote;
  const fee = BigInt(quote.fee);
  if (fee < 0n || fee > BigInt(deployment.maximumRelayFeeAtomic)) {
    throw new Error("Payment relay fee exceeds the configured limit.");
  }
  return { client, quote };
}

async function relayTransition(input: {
  api: MorosPaymentClient;
  contractClient: DynamicContractClient;
  method: "transfer" | "withdraw";
  args: Record<string, unknown>;
  progress?: (value: PaymentActionProgress) => void;
}): Promise<string> {
  const encoded = input.contractClient.spec.funcArgsToScVals(input.method, input.args)
    .map((value) => value.toXDR("base64"));
  input.progress?.("submitting");
  const result = await input.api.relay({ method: input.method, args: encoded });
  input.progress?.("confirming");
  return relayHash(result);
}

export async function depositPrivateUsdc(input: {
  deployment: PaymentDeployment;
  source: string;
  recipientCode: string;
  amountAtomic: bigint;
  progress?: (value: PaymentActionProgress) => void;
}): Promise<string> {
  if (input.amountAtomic <= 0n) throw new Error("Deposit amount must be positive.");
  input.progress?.("preparing");
  const network = await getNetworkDetails();
  if (network.error) throw network.error;
  if (network.networkPassphrase !== input.deployment.networkPassphrase) {
    throw new Error(`Switch Freighter to ${input.deployment.environment}.`);
  }
  const { info } = await readVault(input.deployment);
  const id = actionId();
  const expiry = Math.floor(Date.now() / 1_000) + 600;
  const protocolIdentity = identity(info.fee.protocol_identity);
  const context = await contextFields({
    deployment: input.deployment,
    networkDomain: info.network_domain,
    verifierDomain: info.verifier_domain,
    action: 0,
    actionId: id,
    expiry,
    publicAccount: input.source,
    publicAmount: input.amountAtomic,
    outputCount: 2,
    feeEpoch: info.fee.epoch,
    relayFee: 0n,
    protocolFee: 0n,
    relayIdentity: protocolIdentity,
    protocolIdentity,
    attachmentHash: 0n,
    relayQuoteDigest: 0n,
  });
  const domain = paymentNoteDomain(context);
  const outputs = [
    await createPaymentOutput({ recipientCode: input.recipientCode, outputIndex: 0, noteDomain: domain, amount: input.amountAtomic }),
    await createPaymentOutput({ recipientCode: input.recipientCode, outputIndex: 1, noteDomain: domain, amount: 0n }),
  ];
  const fields = publicFields({
    action: 0,
    context,
    membershipRoot: 0n,
    nullifiers: [],
    outputs,
    attachmentHash: 0n,
    publicAmount: input.amountAtomic,
  });
  input.progress?.("proving");
  const proof = await provePayment({
    deployment: input.deployment,
    circuit: "deposit",
    witness: { ...fields, contextFields: context, ...outputWitness(outputs) },
    expected: fields,
  });
  const preparedTransition = transition({ action: 0, circuit: "Deposit", fields, proof, outputs });
  let lastError: unknown;
  let preparedTransaction: ContractMethodResult<unknown> | null = null;
  for (const endpoint of input.deployment.rpcUrls) {
    try {
      const server = new rpc.Server(endpoint, { allowHttp: input.deployment.environment === "local" });
      const wasm = await server.getContractWasmByContractId(input.deployment.vault);
      const client = await contract.Client.fromWasm(wasm, {
        contractId: input.deployment.vault,
        publicKey: input.source,
        networkPassphrase: input.deployment.networkPassphrase,
        rpcUrl: endpoint,
        allowHttp: input.deployment.environment === "local",
        signTransaction: async (transactionXdr: string, options: { networkPassphrase?: string } = {}) => {
          input.progress?.("approving");
          const passphrase = options.networkPassphrase || input.deployment.networkPassphrase;
          const signed = await signTransaction(transactionXdr, { networkPassphrase: passphrase, address: input.source });
          if (signed.error || !signed.signedTxXdr) throw signed.error || new Error("Freighter did not sign the deposit.");
          TransactionBuilder.fromXDR(signed.signedTxXdr, passphrase);
          input.progress?.("submitting");
          return { signedTxXdr: signed.signedTxXdr, signerAddress: input.source };
        },
      }) as unknown as DynamicContractClient;
      const method = client.deposit;
      if (typeof method !== "function") throw new Error("Payment vault deposit method is unavailable.");
      preparedTransaction = await method.call(client, {
        source: input.source,
        action_id: id,
        expiry: BigInt(expiry),
        transition: preparedTransition,
      }, { timeoutInSeconds: 300 }) as ContractMethodResult<unknown>;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!preparedTransaction) {
    throw lastError instanceof Error ? lastError : new Error("Deposit preparation failed across all Stellar RPC providers.");
  }
  const sent = await preparedTransaction.signAndSend();
  input.progress?.("confirming");
  const hash = sent.sendTransactionResponse?.hash || sent.hash;
  if (!hash) throw new Error("Deposit did not return a transaction hash.");
  return hash;
}

export async function transferPrivateUsdc(input: {
  deployment: PaymentDeployment;
  senderCode: string;
  recipientCode: string;
  amountAtomic: bigint;
  memo: string;
  payloadHash?: bigint;
  prepareSpend(requiredAtomic: bigint, signal?: AbortSignal): Promise<PreparedPrivateSpend>;
  progress?: (value: PaymentActionProgress) => void;
}): Promise<string> {
  if (input.amountAtomic <= 0n) throw new Error("Payment amount must be positive.");
  input.progress?.("preparing");
  const { client: vault, info } = await readVault(input.deployment);
  const id = actionId();
  const expiry = Math.floor(Date.now() / 1_000) + 600;
  const { client: api, quote } = await quoteFor(input.deployment, id, expiry);
  const relayIdentity = identity(quote.paymentIdentity);
  const protocolIdentity = identity(info.fee.protocol_identity);
  const relayFee = BigInt(quote.fee);
  const protocolFee = BigInt(info.fee.protocol_fee);
  const required = input.amountAtomic + relayFee + protocolFee;
  const spend = await input.prepareSpend(required);
  const attachment = await createPaymentAttachment(input.memo, input.recipientCode);
  const quoteDigest = await relayQuoteDigest({
    deployment: input.deployment,
    networkDomain: info.network_domain,
    actionId: id,
    quoteId: Uint8Array.from(quote.quoteId.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)),
    signingKey: Uint8Array.from(quote.signingKey.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)),
    fee: relayFee,
    expiry: BigInt(quote.expiry),
    identity: relayIdentity,
  });
  const context = await contextFields({
    deployment: input.deployment,
    networkDomain: info.network_domain,
    verifierDomain: info.verifier_domain,
    action: 1,
    actionId: id,
    expiry,
    publicAmount: 0n,
    outputCount: 4,
    feeEpoch: info.fee.epoch,
    relayFee,
    protocolFee,
    relayIdentity,
    protocolIdentity,
    attachmentHash: attachment.hash,
    relayQuoteDigest: quoteDigest,
  });
  const domain = paymentNoteDomain(context);
  const relayCode = await paymentCodeForIdentity(input.senderCode, relayIdentity);
  const protocolCode = await paymentCodeForIdentity(input.senderCode, protocolIdentity);
  const outputs = [
    await createPaymentOutput({
      recipientCode: input.recipientCode,
      outputIndex: 0,
      noteDomain: domain,
      amount: input.amountAtomic,
      payloadHash: input.payloadHash ?? randomField(),
      privateData: [attachment.hash, 0n],
    }),
    await createPaymentOutput({
      recipientCode: input.senderCode,
      outputIndex: 1,
      noteDomain: domain,
      amount: spend.totalAtomic - required,
    }),
    await createPaymentOutput({ recipientCode: relayCode, outputIndex: 2, noteDomain: domain, amount: relayFee }),
    await createPaymentOutput({ recipientCode: protocolCode, outputIndex: 3, noteDomain: domain, amount: protocolFee }),
  ];
  const tree = merkleTree(spend.commitments, input.deployment.treeLevels);
  const nullifiers = spend.notes.map((note) => note.nullifier);
  const fields = publicFields({
    action: 1,
    context,
    membershipRoot: tree.root,
    nullifiers,
    outputs,
    attachmentHash: attachment.hash,
    publicAmount: 0n,
  });
  const selectedCircuit = circuit(spend.notes.length, "transfer");
  input.progress?.("proving");
  const proof = await provePayment({
    deployment: input.deployment,
    circuit: selectedCircuit.name,
    witness: {
      ...fields,
      contextFields: context,
      attachmentFields: attachment.fields,
      ...noteWitness(spend.notes, tree),
      ...outputWitness(outputs),
    },
    expected: fields,
  });
  const preparedTransition = transition({
    action: 1,
    circuit: selectedCircuit.tag,
    fields,
    proof,
    outputs,
    attachment: attachment.bytes,
  });
  return relayTransition({
    api,
    contractClient: vault,
    method: "transfer",
    args: {
      action_id: id,
      expiry: BigInt(expiry),
      fee_epoch: info.fee.epoch,
      quote: quoteNative(quote),
      transition: preparedTransition,
    },
    progress: input.progress,
  });
}

export async function withdrawPrivateUsdc(input: {
  deployment: PaymentDeployment;
  senderCode: string;
  destination: string;
  amountAtomic: bigint;
  prepareSpend(requiredAtomic: bigint, signal?: AbortSignal): Promise<PreparedPrivateSpend>;
  progress?: (value: PaymentActionProgress) => void;
}): Promise<string> {
  if (input.amountAtomic <= 0n) throw new Error("Withdrawal amount must be positive.");
  input.progress?.("preparing");
  const { client: vault, info } = await readVault(input.deployment);
  const id = actionId();
  const expiry = Math.floor(Date.now() / 1_000) + 600;
  const { client: api, quote } = await quoteFor(input.deployment, id, expiry);
  const relayIdentity = identity(quote.paymentIdentity);
  const protocolIdentity = identity(info.fee.protocol_identity);
  const relayFee = BigInt(quote.fee);
  const protocolFee = BigInt(info.fee.protocol_fee);
  const required = input.amountAtomic + relayFee + protocolFee;
  const spend = await input.prepareSpend(required);
  const quoteDigest = await relayQuoteDigest({
    deployment: input.deployment,
    networkDomain: info.network_domain,
    actionId: id,
    quoteId: Uint8Array.from(quote.quoteId.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)),
    signingKey: Uint8Array.from(quote.signingKey.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)),
    fee: relayFee,
    expiry: BigInt(quote.expiry),
    identity: relayIdentity,
  });
  const context = await contextFields({
    deployment: input.deployment,
    networkDomain: info.network_domain,
    verifierDomain: info.verifier_domain,
    action: 2,
    actionId: id,
    expiry,
    publicAccount: input.destination,
    publicAmount: -input.amountAtomic,
    outputCount: 3,
    feeEpoch: info.fee.epoch,
    relayFee,
    protocolFee,
    relayIdentity,
    protocolIdentity,
    attachmentHash: 0n,
    relayQuoteDigest: quoteDigest,
  });
  const domain = paymentNoteDomain(context);
  const relayCode = await paymentCodeForIdentity(input.senderCode, relayIdentity);
  const protocolCode = await paymentCodeForIdentity(input.senderCode, protocolIdentity);
  const outputs = [
    await createPaymentOutput({ recipientCode: input.senderCode, outputIndex: 0, noteDomain: domain, amount: spend.totalAtomic - required }),
    await createPaymentOutput({ recipientCode: relayCode, outputIndex: 1, noteDomain: domain, amount: relayFee }),
    await createPaymentOutput({ recipientCode: protocolCode, outputIndex: 2, noteDomain: domain, amount: protocolFee }),
  ];
  const tree = merkleTree(spend.commitments, input.deployment.treeLevels);
  const nullifiers = spend.notes.map((note) => note.nullifier);
  const fields = publicFields({
    action: 2,
    context,
    membershipRoot: tree.root,
    nullifiers,
    outputs,
    attachmentHash: 0n,
    publicAmount: -input.amountAtomic,
  });
  const selectedCircuit = circuit(spend.notes.length, "withdraw");
  input.progress?.("proving");
  const proof = await provePayment({
    deployment: input.deployment,
    circuit: selectedCircuit.name,
    witness: {
      ...fields,
      contextFields: context,
      ...noteWitness(spend.notes, tree),
      ...outputWitness(outputs),
    },
    expected: fields,
  });
  const preparedTransition = transition({ action: 2, circuit: selectedCircuit.tag, fields, proof, outputs });
  return relayTransition({
    api,
    contractClient: vault,
    method: "withdraw",
    args: {
      destination: input.destination,
      action_id: id,
      expiry: BigInt(expiry),
      emergency: false,
      fee_epoch: info.fee.epoch,
      quote: quoteNative(quote),
      transition: preparedTransition,
    },
    progress: input.progress,
  });
}
