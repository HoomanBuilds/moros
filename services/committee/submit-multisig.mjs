import "../config.mjs";
import {
  rpc, TransactionBuilder, Networks, BASE_FEE, Contract, Address, Keypair,
  nativeToScVal, scValToNative, xdr, Operation, authorizeEntry,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const MARKET = process.env.MARKET;
const DQYES = BigInt(process.env.DQYES);
const DQNO = BigInt(process.env.DQNO);
const funderKp = Keypair.fromSecret(process.env.FUNDER_SK);
const signerKps = [Keypair.fromSecret(process.env.SIGNER1_SK), Keypair.fromSecret(process.env.SIGNER2_SK)];

const server = new rpc.Server(RPC_URL);
const passphrase = Networks.TESTNET;
const contract = new Contract(MARKET);

const args = [
  xdr.ScVal.scvVec(signerKps.map((kp) => new Address(kp.publicKey()).toScVal())),
  new Address(funderKp.publicKey()).toScVal(),
  nativeToScVal(DQYES, { type: "i128" }),
  nativeToScVal(DQNO, { type: "i128" }),
];

const account = await server.getAccount(funderKp.publicKey());
const tx = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10000).toString(), networkPassphrase: passphrase })
  .addOperation(contract.call("apply_batch_committee", ...args))
  .setTimeout(120)
  .build();

const sim = await server.simulateTransaction(tx);
if (rpc.Api.isSimulationError(sim)) {
  console.error("simulation failed:", sim.error);
  process.exit(1);
}

const { sequence } = await server.getLatestLedger();
const validUntil = sequence + 100;

const signedAuth = [];
for (const entry of sim.result.auth) {
  if (entry.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()) {
    signedAuth.push(entry);
    continue;
  }
  const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
  const kp = signerKps.find((k) => k.publicKey() === addr);
  if (!kp) {
    console.error("no key for auth entry address:", addr);
    process.exit(1);
  }
  signedAuth.push(await authorizeEntry(entry, kp, validUntil, passphrase));
  console.log("signed auth entry for committee member", addr);
}

const account2 = await server.getAccount(funderKp.publicKey());
const tx2 = new TransactionBuilder(account2, { fee: (Number(BASE_FEE) * 10000).toString(), networkPassphrase: passphrase })
  .addOperation(
    Operation.invokeHostFunction({
      func: tx.operations[0].func,
      auth: signedAuth,
    })
  )
  .setTimeout(120)
  .build();

const sim2 = await server.simulateTransaction(tx2);
if (rpc.Api.isSimulationError(sim2)) {
  console.error("re-simulation failed:", sim2.error);
  process.exit(1);
}
const prepared = rpc.assembleTransaction(tx2, sim2).build();
prepared.sign(funderKp);

const sent = await server.sendTransaction(prepared);
if (sent.status === "ERROR") {
  console.error("send failed:", JSON.stringify(sent.errorResult));
  process.exit(1);
}
console.log("tx submitted:", sent.hash);

let result;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  result = await server.getTransaction(sent.hash);
  if (result.status !== "NOT_FOUND") break;
}
if (result.status !== "SUCCESS") {
  console.error("tx failed:", result.status, result.resultXdr?.toXDR("base64"));
  process.exit(1);
}
console.log("SUCCESS: net charged (atomic units) =", scValToNative(result.returnValue));
console.log("tx hash:", sent.hash);
process.exit(0);
