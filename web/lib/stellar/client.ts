import { rpc, Contract, TransactionBuilder, Account, Keypair, scValToNative } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";

const server = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false });
const sourcePk = Keypair.random().publicKey();

export async function readContract(contractId: string, method: string, args: unknown[] = []) {
  const contract = new Contract(contractId);
  const source = new Account(sourcePk, "0");
  const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: NETWORK.passphrase })
    .addOperation(contract.call(method, ...(args as never[])))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result) throw new Error("no result");
  return scValToNative(sim.result.retval);
}
