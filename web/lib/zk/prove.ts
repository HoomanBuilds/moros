import * as snarkjs from "snarkjs";

export async function proveEncryptOrder(input: Record<string, unknown>) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/zk/encrypt_order.wasm",
    "/zk/encrypt_order_final.zkey"
  );
  return { proof, publicSignals };
}
