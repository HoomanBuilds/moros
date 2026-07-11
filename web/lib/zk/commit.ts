import * as snarkjs from "snarkjs";

export type OrderInput = {
  amount: string;
  side: string;
  secret: string;
  nullifier: string;
};

export type Commitment = {
  commitment: string;
  nullifierHash: string;
};

export async function computeCommitment(order: OrderInput): Promise<Commitment> {
  const wtns = { type: "mem" };
  await snarkjs.wtns.calculate(order, "/zk/order_commit.wasm", wtns);
  const witness = await snarkjs.wtns.exportJson(wtns);
  return { commitment: witness[1].toString(), nullifierHash: witness[2].toString() };
}
