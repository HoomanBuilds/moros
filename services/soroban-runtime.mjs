import {
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  contract,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

export function signingOptions(source, rpcUrl, networkPassphrase) {
  return {
    publicKey: source.publicKey(),
    networkPassphrase,
    rpcUrl,
    signTransaction: async (transactionXdr, options = {}) => {
      const transaction = TransactionBuilder.fromXDR(
        transactionXdr,
        options.networkPassphrase || networkPassphrase,
      );
      transaction.sign(source);
      return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: source.publicKey(),
      };
    },
  };
}

export async function contractClient({
  server,
  contractId,
  source,
  rpcUrl,
  networkPassphrase,
}) {
  const wasm = await server.getContractWasmByContractId(contractId);
  return contract.Client.fromWasm(wasm, {
    ...signingOptions(source, rpcUrl, networkPassphrase),
    contractId,
  });
}

export async function submitInvocation({
  server,
  source,
  contractId,
  method,
  args = [],
  networkPassphrase,
  timeoutSeconds = 120,
}) {
  const account = await server.getAccount(source.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 100_000).toString(),
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(timeoutSeconds)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`simulation failed: ${simulation.error}`);
  }
  const prepared = rpc.assembleTransaction(transaction, simulation).build();
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error("transaction submission was rejected");
  }
  return waitForSubmittedTransaction({ server, hash: sent.hash });
}

export async function waitForSubmittedTransaction({
  server,
  hash,
  pollIntervalMs = 1_000,
  maximumWaitMs = 120_000,
  sleep = (milliseconds) =>
    new Promise((done) => setTimeout(done, milliseconds)),
}) {
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 250 ||
    !Number.isSafeInteger(maximumWaitMs) ||
    maximumWaitMs < pollIntervalMs
  ) {
    throw new Error("invalid transaction confirmation polling configuration");
  }
  const attempts = Math.ceil(maximumWaitMs / pollIntervalMs);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await server.getTransaction(hash);
    if (result.status === "SUCCESS") {
      return {
        hash,
        result: result.returnValue
          ? scValToNative(result.returnValue)
          : undefined,
      };
    }
    if (result.status === "FAILED") {
      throw new Error(`transaction ${hash} failed`);
    }
    if (attempt + 1 < attempts) await sleep(pollIntervalMs);
  }
  throw new Error(`transaction ${hash} timed out`);
}

export function runtimeSource(secret) {
  if (!secret) throw new Error("FUNDER_SK is required");
  return Keypair.fromSecret(secret);
}
