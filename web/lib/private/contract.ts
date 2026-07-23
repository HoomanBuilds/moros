"use client";

import {
  TransactionBuilder,
  contract,
  rpc,
} from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
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

async function contractWasm(contractId: string): Promise<Buffer> {
  let promise = wasmCache.get(contractId);
  if (!promise) {
    promise = server.getContractWasmByContractId(contractId);
    wasmCache.set(contractId, promise);
  }
  return promise;
}

export async function privateContractClient(
  contractId: string,
  address: string,
): Promise<DynamicContractClient> {
  const wasm = await contractWasm(contractId);
  return contract.Client.fromWasm(wasm, {
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
  }) as unknown as DynamicContractClient;
}

export async function readPrivateContract<T>(
  contractId: string,
  address: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const client = await privateContractClient(contractId, address);
  const call = client[method];
  if (typeof call !== "function") throw new Error(`Contract method ${method} is unavailable`);
  const transaction = await call.call(client, args) as ContractMethodResult<T>;
  return transaction.result;
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
