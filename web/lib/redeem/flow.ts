"use client";
import { getProof, postRedeem } from "@/lib/committee/client";
import { getOutcome, getClearingPrice, getFeeConfig } from "@/lib/stellar/read";
import { outcomeLabel } from "@/lib/stellar/derive";
import { recipientField } from "@/lib/stellar/recipient";
import { proveRedeem } from "@/lib/zk/redeem";

export type RedeemStage = "preparing" | "proving" | "submitting" | "done";

export async function runRedeem(
  { position, address, marketId, poolId, protocolVersion = 2, onStage }:
  { position: { amount: string; stakeAmount?: string; side: string; secret: string; nullifier: string; commitment: string }; address: string; marketId?: string; poolId?: string; protocolVersion?: 2 | 3; onStage: (s: RedeemStage) => void }
) {
  onStage("preparing");
  const [rawOutcome, priceYesRaw, feeConfig] = await Promise.all([
    getOutcome(marketId),
    getClearingPrice(poolId),
    protocolVersion === 3 && poolId ? getFeeConfig(poolId) : Promise.resolve<[string, number]>(["", 0]),
  ]);
  const outcome = outcomeLabel(rawOutcome);
  if (outcome === "LIVE") throw new Error("market not resolved yet");
  const { pathIndex, siblings, orderRoot } = await getProof(position.commitment);
  const winningOutcome = outcome === "YES" ? "1" : "0";
  const priceYes = priceYesRaw.toString();
  const recipient = recipientField(address);
  const input: Record<string, unknown> = {
    orderRoot, recipient, winningOutcome, priceYes, fee: "0",
    amount: position.amount, side: position.side, secret: position.secret, nullifier: position.nullifier,
    pathIndex, siblings,
  };
  if (protocolVersion === 3) {
    const scale = 1n << 32n;
    const amount = BigInt(position.amount);
    const side = BigInt(position.side);
    const winner = BigInt(winningOutcome);
    const sidePrice = side === 1n ? priceYesRaw : scale - priceYesRaw;
    const win = side === winner ? 1n : 0n;
    const feeBps = BigInt(feeConfig[1]);
    input.fee = (win * amount * (scale - sidePrice) * feeBps / 10_000n).toString();
    input.feeBps = feeBps.toString();
    input.stakeAmount = position.stakeAmount ?? position.amount;
  }
  onStage("proving");
  const { proof, publicSignals } = await proveRedeem(input, protocolVersion);
  onStage("submitting");
  const res = await postRedeem({ proof, publicSignals, recipient: address, poolId: poolId ?? "", protocolVersion });
  onStage("done");
  return { res };
}
