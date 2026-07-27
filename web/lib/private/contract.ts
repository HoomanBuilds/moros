"use client";

import {
  TransactionBuilder,
  contract,
  rpc,
} from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import {
  rpcReadScheduler,
  type RpcReadOptions,
} from "@/lib/stellar/rpc-read";
import { getKit } from "@/lib/wallet";
import { relayPrivateCall } from "./client";

type ContractMethodResult<T> = {
  result: T;
  signAndSend: () => Promise<{
    sendTransactionResponse?: { hash?: string };
  }>;
};

export type DynamicContractClient = {
  spec: contract.Spec;
  [method: string]: unknown;
};

const server = new rpc.Server(NETWORK.rpcUrl);
const wasmCache = new Map<string, Promise<Buffer>>();
const clientCache = new Map<string, Promise<DynamicContractClient>>();
const readInFlight = new Map<string, Promise<unknown>>();

async function contractWasm(contractId: string): Promise<Buffer> {
  let promise = wasmCache.get(contractId);
  if (!promise) {
    promise = rpcReadScheduler.schedule(
      () => server.getContractWasmByContractId(contractId),
      { priority: "interactive" },
    ).catch((error) => {
      wasmCache.delete(contractId);
      throw error;
    });
    wasmCache.set(contractId, promise);
  }
  return promise;
}

export async function privateContractClient(
  contractId: string,
  address: string,
): Promise<DynamicContractClient> {
  const key = `${contractId}:${address}`;
  let promise = clientCache.get(key);
  if (!promise) {
    promise = contractWasm(contractId)
      .then((wasm) => contract.Client.fromWasm(wasm, {
        contractId,
        publicKey: address,
        networkPassphrase: NETWORK.passphrase,
        rpcUrl: NETWORK.rpcUrl,
        signTransaction: async (
          transactionXdr: string,
          options: { networkPassphrase?: string } = {},
        ) => {
          const passphrase = options.networkPassphrase || NETWORK.passphrase;
          const { signedTxXdr } = await getKit().signTransaction(
            transactionXdr,
            { networkPassphrase: passphrase, address },
          );
          TransactionBuilder.fromXDR(signedTxXdr, passphrase);
          return { signedTxXdr, signerAddress: address };
        },
      }) as unknown as DynamicContractClient)
      .catch((error) => {
        clientCache.delete(key);
        throw error;
      });
    clientCache.set(key, promise);
  }
  return promise;
}

function stableValue(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key}:${stableValue(entry)}`)
      .join(",")}}`;
  }
  return String(value);
}

export async function readPrivateContract<T>(
  contractId: string,
  address: string,
  method: string,
  args: Record<string, unknown> = {},
  options: RpcReadOptions = {},
): Promise<T> {
  const key = [
    options.priority ?? "normal",
    contractId,
    address,
    method,
    stableValue(args),
  ].join(":");
  const existing = readInFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = (async () => {
    const client = await privateContractClient(contractId, address);
    return rpcReadScheduler.schedule(async () => {
      const call = client[method];
      if (typeof call !== "function") {
        throw new Error(`Contract method ${method} is unavailable`);
      }
      const transaction = await call.call(client, args) as ContractMethodResult<T>;
      return transaction.result;
    }, options);
  })().finally(() => {
    readInFlight.delete(key);
  });
  readInFlight.set(key, promise);
  return promise;
}

export async function sendPrivateWalletCall(
  contractId: string,
  address: string,
  method: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = await privateContractClient(contractId, address);
  const call = client[method];
  if (typeof call !== "function") throw new Error(`Contract method ${method} is unavailable`);
  const transaction = await call.call(client, args) as ContractMethodResult<unknown>;
  const sent = await transaction.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error(`${method} did not return a transaction hash`);
  return hash;
}

export async function relayPrivateContractCall(
  contractId: string,
  address: string,
  method: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = await privateContractClient(contractId, address);
  const encoded = client.spec.funcArgsToScVals(method, args)
    .map((value) => value.toXDR("base64"));
  return (await relayPrivateCall(method, encoded)).hash;
}
