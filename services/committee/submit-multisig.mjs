import "../config.mjs";
import {
  rpc, TransactionBuilder, Networks, BASE_FEE, Contract, Address, Keypair,
  nativeToScVal, scValToNative, xdr, Operation, authorizeEntry,
} from "@stellar/stellar-sdk";
import { fileURLToPath } from "url";

export async function submitPoolBatch({ pool, dqyesFp, dqnoFp, nullHashes, commitments, protocolVersion = 2, signerAddrs, sourceSk, attest, rpcUrl }) {
  if (protocolVersion === 3 && (!Array.isArray(commitments) || commitments.length !== nullHashes.length || commitments.length < 1 || commitments.length > 4)) {
    throw new Error("batch commitments must match 1 to 4 nullifier hashes");
  }
  const server = new rpc.Server(rpcUrl ?? process.env.RPC_URL ?? "https://soroban-testnet.stellar.org");
  const passphrase = Networks.TESTNET;
  const sourceKp = Keypair.fromSecret(sourceSk);
  const contract = new Contract(pool);

  const args = [
    xdr.ScVal.scvVec(signerAddrs.map((a) => new Address(a).toScVal())),
    nativeToScVal(BigInt(dqyesFp), { type: "i128" }),
    nativeToScVal(BigInt(dqnoFp), { type: "i128" }),
    xdr.ScVal.scvVec(nullHashes.map((h) => xdr.ScVal.scvBytes(Buffer.from(h, "hex")))),
  ];
  if (protocolVersion === 3) {
    args.push(xdr.ScVal.scvVec(commitments.map((h) => xdr.ScVal.scvBytes(Buffer.from(h, "hex")))));
  }

  const account = await server.getAccount(sourceKp.publicKey());
  const tx = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10000).toString(), networkPassphrase: passphrase })
    .addOperation(contract.call("submit_batch_committee", ...args))
    .setTimeout(120)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);

  const { sequence } = await server.getLatestLedger();
  const validUntil = sequence + 100;

  const signedAuth = [];
  for (const entry of sim.result.auth) {
    if (entry.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()) {
      signedAuth.push(entry);
      continue;
    }
    const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
    const signedXdr = await attest({ address: addr, entryXdr: entry.toXDR("base64"), validUntilLedger: validUntil });
    signedAuth.push(xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64"));
  }

  const account2 = await server.getAccount(sourceKp.publicKey());
  const tx2 = new TransactionBuilder(account2, { fee: (Number(BASE_FEE) * 10000).toString(), networkPassphrase: passphrase })
    .addOperation(Operation.invokeHostFunction({ func: tx.operations[0].func, auth: signedAuth }))
    .setTimeout(120)
    .build();

  const sim2 = await server.simulateTransaction(tx2);
  if (rpc.Api.isSimulationError(sim2)) throw new Error(`re-simulation failed: ${sim2.error}`);
  const prepared = rpc.assembleTransaction(tx2, sim2).build();
  prepared.sign(sourceKp);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);

  let result;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(sent.hash);
    if (result.status !== "NOT_FOUND") break;
  }
  if (result.status !== "SUCCESS") throw new Error(`tx failed: ${result.status} ${result.resultXdr?.toXDR("base64")}`);
  return { hash: sent.hash, net: scValToNative(result.returnValue) };
}

export async function submitCommitteeBatch({ market, dqyes, dqno, funderSk, signerSks, signerAddrs, attest, rpcUrl }) {
  const server = new rpc.Server(rpcUrl ?? process.env.RPC_URL ?? "https://soroban-testnet.stellar.org");
  const passphrase = Networks.TESTNET;
  const funderKp = Keypair.fromSecret(funderSk);
  const signerKps = (signerSks ?? []).map((s) => Keypair.fromSecret(s));
  const addrs = signerAddrs ?? signerKps.map((kp) => kp.publicKey());
  const contract = new Contract(market);

  const args = [
    xdr.ScVal.scvVec(addrs.map((a) => new Address(a).toScVal())),
    new Address(funderKp.publicKey()).toScVal(),
    nativeToScVal(BigInt(dqyes), { type: "i128" }),
    nativeToScVal(BigInt(dqno), { type: "i128" }),
  ];

  const account = await server.getAccount(funderKp.publicKey());
  const tx = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10000).toString(), networkPassphrase: passphrase })
    .addOperation(contract.call("apply_batch_committee", ...args))
    .setTimeout(120)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);

  const { sequence } = await server.getLatestLedger();
  const validUntil = sequence + 100;

  const signedAuth = [];
  for (const entry of sim.result.auth) {
    if (entry.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()) {
      signedAuth.push(entry);
      continue;
    }
    const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
    if (attest) {
      const signedXdr = await attest({ address: addr, entryXdr: entry.toXDR("base64"), validUntilLedger: validUntil });
      signedAuth.push(xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64"));
      continue;
    }
    const kp = signerKps.find((k) => k.publicKey() === addr);
    if (!kp) throw new Error(`no key for auth entry address: ${addr}`);
    signedAuth.push(await authorizeEntry(entry, kp, validUntil, passphrase));
  }

  const account2 = await server.getAccount(funderKp.publicKey());
  const tx2 = new TransactionBuilder(account2, { fee: (Number(BASE_FEE) * 10000).toString(), networkPassphrase: passphrase })
    .addOperation(Operation.invokeHostFunction({ func: tx.operations[0].func, auth: signedAuth }))
    .setTimeout(120)
    .build();

  const sim2 = await server.simulateTransaction(tx2);
  if (rpc.Api.isSimulationError(sim2)) throw new Error(`re-simulation failed: ${sim2.error}`);
  const prepared = rpc.assembleTransaction(tx2, sim2).build();
  prepared.sign(funderKp);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);

  let result;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(sent.hash);
    if (result.status !== "NOT_FOUND") break;
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`tx failed: ${result.status} ${result.resultXdr?.toXDR("base64")}`);
  }
  return { hash: sent.hash, net: scValToNative(result.returnValue) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await submitCommitteeBatch({
    market: process.env.MARKET,
    dqyes: process.env.DQYES,
    dqno: process.env.DQNO,
    funderSk: process.env.FUNDER_SK,
    signerSks: [process.env.SIGNER1_SK, process.env.SIGNER2_SK],
  });
  console.log("SUCCESS: net charged (atomic units) =", out.net);
  console.log("tx hash:", out.hash);
  process.exit(0);
}
