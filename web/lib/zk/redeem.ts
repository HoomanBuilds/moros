import * as snarkjs from "snarkjs";

export async function proveRedeem(input: Record<string, unknown>, version: 2 | 3 = 2) {
  const name = version === 3 ? "order_redeem_v3" : "order_redeem_v2";
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, `/zk/${name}.wasm`, `/zk/${name}_final.zkey`);
  return { proof, publicSignals };
}
