import { rpc, TransactionBuilder, Contract, Address, nativeToScVal, xdr, BASE_FEE } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { getKit } from "@/lib/wallet";

const server = new rpc.Server(NETWORK.rpcUrl);

export async function placeOrder(commitmentDec: string, stakeAtomic: bigint): Promise<string> {
  const kit = getKit();
  const { address } = await kit.getAddress();
  const account = await server.getAccount(address);
  const commitmentBytes = Buffer.from(BigInt(commitmentDec).toString(16).padStart(64, "0"), "hex");
  const contract = new Contract(NETWORK.poolId);
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
