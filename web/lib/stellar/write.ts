import { rpc, TransactionBuilder, Contract, Address, nativeToScVal, xdr, BASE_FEE } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { getKit } from "@/lib/wallet";
import { stellarStringHashHex } from "@/lib/markets/rules";

const server = new rpc.Server(NETWORK.rpcUrl);

async function submitWalletCall(contractId: string, method: string, args: xdr.ScVal[]): Promise<string> {
  const kit = getKit();
  const { address } = await kit.getAddress();
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK.passphrase, address });
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
  if (sent.status === "ERROR") throw new Error(`${method} failed to send`);
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") throw new Error(`${method} failed on-chain`);
  }
  throw new Error(`${method} timed out`);
}

function outcomeArg(outcome: "YES" | "NO" | "VOID"): xdr.ScVal {
  const tag = outcome === "YES" ? "Yes" : outcome === "NO" ? "No" : "Void";
  return xdr.ScVal.scvVec([nativeToScVal(tag, { type: "symbol" })]);
}

export async function proposeEventResult(
  resolverId: string,
  marketId: string,
  proposer: string,
  outcome: "YES" | "NO" | "VOID",
  evidenceRef: string,
): Promise<string> {
  const evidenceHash = stellarStringHashHex(evidenceRef);
  return submitWalletCall(resolverId, "propose", [
    Address.fromString(marketId).toScVal(),
    Address.fromString(proposer).toScVal(),
    outcomeArg(outcome),
    nativeToScVal(evidenceRef, { type: "string" }),
    xdr.ScVal.scvBytes(Buffer.from(evidenceHash, "hex")),
  ]);
}

export async function challengeEventResult(
  resolverId: string,
  marketId: string,
  challenger: string,
  outcome: "YES" | "NO" | "VOID",
  evidenceRef: string,
): Promise<string> {
  const evidenceHash = stellarStringHashHex(evidenceRef);
  return submitWalletCall(resolverId, "challenge", [
    Address.fromString(marketId).toScVal(),
    Address.fromString(challenger).toScVal(),
    outcomeArg(outcome),
    nativeToScVal(evidenceRef, { type: "string" }),
    xdr.ScVal.scvBytes(Buffer.from(evidenceHash, "hex")),
  ]);
}

export async function finalizeEventResult(resolverId: string, marketId: string): Promise<string> {
  return submitWalletCall(resolverId, "finalize", [Address.fromString(marketId).toScVal()]);
}

export async function voteEventResult(
  resolverId: string,
  marketId: string,
  member: string,
  outcome: "YES" | "NO" | "VOID",
): Promise<string> {
  return submitWalletCall(resolverId, "vote", [
    Address.fromString(marketId).toScVal(),
    Address.fromString(member).toScVal(),
    outcomeArg(outcome),
  ]);
}

export async function placeOrder(commitmentDec: string, stakeAtomic: bigint, poolId: string = NETWORK.poolId): Promise<string> {
  const kit = getKit();
  const { address } = await kit.getAddress();
  const account = await server.getAccount(address);
  const commitmentBytes = Buffer.from(BigInt(commitmentDec).toString(16).padStart(64, "0"), "hex");
  const contract = new Contract(poolId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(contract.call(
      "place_order",
      Address.fromString(address).toScVal(),
      xdr.ScVal.scvBytes(commitmentBytes),
      nativeToScVal(stakeAtomic, { type: "i128" }),
    ))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK.passphrase, address });
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
  if (sent.status === "ERROR") throw new Error("place_order failed to send");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await server.getTransaction(sent.hash);
    if (g.status === "SUCCESS") return sent.hash;
    if (g.status === "FAILED") throw new Error("place_order tx failed");
  }
  throw new Error("place_order timed out");
}

export async function refundOrder(commitmentDec: string, poolId: string = NETWORK.poolId): Promise<string> {
  const kit = getKit();
  const { address } = await kit.getAddress();
  const account = await server.getAccount(address);
  const commitmentBytes = Buffer.from(BigInt(commitmentDec).toString(16).padStart(64, "0"), "hex");
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(new Contract(poolId).call(
      "refund_order",
      Address.fromString(address).toScVal(),
      xdr.ScVal.scvBytes(commitmentBytes),
    ))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  const { signedTxXdr } = await kit.signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK.passphrase, address });
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
  if (sent.status === "ERROR") throw new Error("refund failed to send");
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") throw new Error("This order is included or is not refundable yet");
  }
  throw new Error("refund timed out");
}
