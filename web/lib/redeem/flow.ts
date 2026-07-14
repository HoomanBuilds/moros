"use client";
import { getProof, postRedeem } from "@/lib/committee/client";
import { getOutcome, getClearingPrice } from "@/lib/stellar/read";
import { outcomeLabel } from "@/lib/stellar/derive";
import { recipientField } from "@/lib/stellar/recipient";
import { proveRedeem } from "@/lib/zk/redeem";

export type RedeemStage = "preparing" | "proving" | "submitting" | "done";

export async function runRedeem(
  { position, address, marketId, poolId, onStage }:
  { position: { amount: string; side: string; secret: string; nullifier: string; commitment: string }; address: string; marketId?: string; poolId?: string; onStage: (s: RedeemStage) => void }
) {
  onStage("preparing");
  const { pathIndex, siblings, orderRoot } = await getProof(position.commitment);
  const outcome = outcomeLabel(await getOutcome(marketId));
  if (outcome === "LIVE") throw new Error("market not resolved yet");
  const winningOutcome = outcome === "YES" ? "1" : "0";
  const priceYes = (await getClearingPrice(poolId)).toString();
  const recipient = recipientField(address);
  const input = {
    orderRoot, recipient, winningOutcome, priceYes, fee: "0",
    amount: position.amount, side: position.side, secret: position.secret, nullifier: position.nullifier,
    pathIndex, siblings,
  };
  onStage("proving");
  const { proof, publicSignals } = await proveRedeem(input);
  onStage("submitting");
  const res = await postRedeem({ proof, publicSignals, recipient: address, poolId: poolId ?? "" });
  onStage("done");
  return { res };
}
