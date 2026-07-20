import assert from "node:assert/strict";
import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  REFLECTOR_CEX_ASSETS,
  REFLECTOR_CEX_ORACLE,
  REFLECTOR_FIAT_ASSETS,
  REFLECTOR_FIAT_ORACLE,
} from "./oracle-config.mjs";

const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const passphrase = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const server = new rpc.Server(rpcUrl);
const source = new Account(Keypair.random().publicKey(), "0");

async function readContract(contractId, method, args = []) {
  const transaction = new TransactionBuilder(source, { fee: "100", networkPassphrase: passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) throw new Error(simulation.error);
  return scValToNative(simulation.result.retval);
}

async function verifyReflector(contractId, expectedAssets) {
  const [base, decimals, assets, retention] = await Promise.all([
    readContract(contractId, "base"),
    readContract(contractId, "decimals"),
    readContract(contractId, "assets"),
    readContract(contractId, "history_retention_period"),
  ]);
  assert.deepEqual(base, ["Other", "USD"]);
  assert.equal(decimals, 14);
  assert.ok(Number(retention) >= 86_400);
  assert.deepEqual(assets, expectedAssets.map((asset) => ["Other", asset]));

  const sample = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    xdr.ScVal.scvSymbol(expectedAssets[0]),
  ]);
  const prices = await readContract(contractId, "prices", [
    sample,
    nativeToScVal(1, { type: "u32" }),
  ]);
  assert.ok(Array.isArray(prices) && prices.length >= 1);
  assert.ok(prices.every((price) => price.price > 0n && price.timestamp > 0n));
}

await verifyReflector(REFLECTOR_CEX_ORACLE, REFLECTOR_CEX_ASSETS);
await verifyReflector(REFLECTOR_FIAT_ORACLE, REFLECTOR_FIAT_ASSETS);

console.log("live Reflector oracles ok");
