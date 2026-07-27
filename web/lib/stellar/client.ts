import { rpc, Contract, TransactionBuilder, Account, Keypair, scValToNative } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import {
  rpcReadScheduler,
  type RpcReadOptions,
} from "./rpc-read";

const server = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false });
const sourcePk = Keypair.random().publicKey();
const inFlight = new Map<string, Promise<unknown>>();

function argumentKey(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "toXDR" in value &&
    typeof (value as { toXDR?: unknown }).toXDR === "function"
  ) {
    return (value as { toXDR: (format: "base64") => string }).toXDR("base64");
  }
  return String(value);
}

export async function readContract(
  contractId: string,
  method: string,
  args: unknown[] = [],
  options: RpcReadOptions = {},
) {
  const key = [
    options.priority ?? "normal",
    contractId,
    method,
    ...args.map(argumentKey),
  ].join(":");
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = rpcReadScheduler.schedule(async () => {
    const contract = new Contract(contractId);
    const source = new Account(sourcePk, "0");
    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: NETWORK.passphrase,
    })
      .addOperation(contract.call(method, ...(args as never[])))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    if (!sim.result) throw new Error("no result");
    return scValToNative(sim.result.retval);
  }, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
