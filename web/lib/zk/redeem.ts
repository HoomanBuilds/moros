import * as snarkjs from "snarkjs";

export async function proveRedeem(input: Record<string, unknown>) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, "/zk/order_redeem_v2.wasm", "/zk/order_redeem_v2_final.zkey");
  return { proof, publicSignals };
}
