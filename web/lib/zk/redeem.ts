import * as snarkjs from "snarkjs";

export async function proveRedeem(input: Record<string, unknown>) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, "/zk/position_redeem.wasm", "/zk/position_redeem_final.zkey");
  return { proof, publicSignals };
}
