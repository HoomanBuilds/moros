"use client";
import { computeCommitment } from "@/lib/zk/commit";
import { proveEncryptOrder } from "@/lib/zk/prove";
import { getPk, getProof, postOrder, registerPool } from "@/lib/committee/client";
import { placeOrder } from "@/lib/stellar/write";
import { addPosition } from "@/lib/positions/book";
import { NETWORK, type CollateralAsset } from "@/lib/network";
import { parseWholeOrderAmount } from "@/lib/stellar/amount";

const R = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

function rand(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return ((BigInt("0x" + hex) % (R - 1n)) + 1n).toString();
}

export type BetSide = "0" | "1";
export type BetStage = "hashing" | "placing" | "proving" | "submitting" | "done";

export async function runBet(
  { side, amount, address, collateral = NETWORK.legacyCollateral, marketId = NETWORK.marketId, poolId = NETWORK.poolId, onStage }:
  { side: BetSide; amount: string; address: string; collateral?: CollateralAsset; marketId?: string; poolId?: string; onStage: (s: BetStage) => void }
) {
  const registered = await registerPool(marketId, poolId);
  const pk = await getPk();
  if (!registered) {
    throw new Error("committee could not register this market - it may be offline; nothing was placed");
  }

  const parsedAmount = parseWholeOrderAmount(amount, collateral.decimals);
  const secret = rand();
  const nullifier = rand();
  onStage("hashing");
  const { commitment } = await computeCommitment({ amount: parsedAmount.orderAmount, side, secret, nullifier });
  onStage("placing");
  const txHash = await placeOrder(commitment, parsedAmount.atomic, poolId);
  addPosition({ address, market: marketId, side, amount: parsedAmount.orderAmount, collateralCode: collateral.code, secret, nullifier, commitment, txHash, status: "placed" });
  onStage("proving");
  const { pathIndex, siblings, orderRoot } = await getProof(commitment);
  const input = { orderRoot, amount: parsedAmount.orderAmount, side, secret, nullifier, ryes: rand(), rno: rand(), pk, pathIndex, siblings };
  const { proof, publicSignals } = await proveEncryptOrder(input);
  onStage("submitting");
  await postOrder({ proof, publicSignals, poolId });
  onStage("done");
}
