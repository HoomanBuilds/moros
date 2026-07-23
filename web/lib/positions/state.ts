import type { PositionStatus } from "./book";

const SCALE = 1n << 32n;

export type MarketOutcome = "YES" | "NO" | "VOID" | "LIVE";
export type ChainOrderStatus = "Pending" | "Included" | "Refunded" | "Redeemed";
export type PositionAction = "retry" | "claim" | "recover" | "refund" | "recover-change" | null;
export type PositionLifecycle =
  | "awaiting_submission"
  | "awaiting_batch"
  | "active"
  | "closed"
  | "recover_execution_change"
  | "claim_winnings"
  | "recover_collateral"
  | "lost"
  | "full_refund"
  | "claimed"
  | "recovered"
  | "refunded";

export type SettlementEstimate = {
  winner: boolean;
  payoutFixed: bigint;
  feeFixed: bigint;
  payoutAtomic: bigint;
  feeAtomic: bigint;
};

export function parseOrderStatus(value: unknown): ChainOrderStatus | null {
  const allowed: ChainOrderStatus[] = ["Pending", "Included", "Refunded", "Redeemed"];
  if (typeof value === "string") return allowed.includes(value as ChainOrderStatus) ? value as ChainOrderStatus : null;
  if (Array.isArray(value)) return parseOrderStatus(value[0]);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.tag !== undefined) return parseOrderStatus(record.tag);
  if (record.status !== undefined) return parseOrderStatus(record.status);
  return parseOrderStatus(Object.keys(record)[0]);
}

export function estimateSettlement({
  amount,
  stakeAmount,
  side,
  outcome,
  priceYes,
  feeBps,
  decimals,
}: {
  amount: string;
  stakeAmount: string;
  side: "0" | "1";
  outcome: "YES" | "NO";
  priceYes: bigint;
  feeBps: number;
  decimals: number;
}): SettlementEstimate {
  const amountValue = BigInt(amount);
  const stakeValue = BigInt(stakeAmount);
  if (amountValue <= 0n || stakeValue < amountValue) throw new Error("Invalid private position amounts");
  if (priceYes < 0n || priceYes > SCALE) throw new Error("Invalid clearing price");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error("Invalid platform fee");
  const sidePrice = side === "1" ? priceYes : SCALE - priceYes;
  const winner = (side === "1" && outcome === "YES") || (side === "0" && outcome === "NO");
  const unusedStake = (stakeValue - amountValue) * SCALE;
  const unspentBudget = amountValue * (SCALE - sidePrice);
  const winnings = winner ? amountValue * SCALE : 0n;
  const feeFixed = winner ? unspentBudget * BigInt(feeBps) / 10_000n : 0n;
  const payoutFixed = unusedStake + unspentBudget + winnings - feeFixed;
  const atomicScale = 10n ** BigInt(decimals);
  return {
    winner,
    payoutFixed,
    feeFixed,
    payoutAtomic: payoutFixed * atomicScale / SCALE,
    feeAtomic: feeFixed * atomicScale / SCALE,
  };
}

export function derivePositionLifecycle({
  localStatus,
  orderStatus,
  outcome,
  acceptingOrders,
  finalizable,
  winner,
  payoutAtomic,
}: {
  localStatus: PositionStatus;
  orderStatus: ChainOrderStatus;
  outcome: MarketOutcome;
  acceptingOrders: boolean;
  finalizable: boolean;
  winner?: boolean;
  payoutAtomic?: bigint;
}): { lifecycle: PositionLifecycle; action: PositionAction } {
  if (orderStatus === "Refunded") {
    return { lifecycle: "refunded", action: null };
  }
  if (orderStatus === "Redeemed") {
    return winner
      ? { lifecycle: "claimed", action: null }
      : { lifecycle: payoutAtomic && payoutAtomic > 0n ? "recovered" : "lost", action: null };
  }
  if (outcome === "VOID") return { lifecycle: "full_refund", action: "refund" };
  if (orderStatus === "Pending") {
    if (outcome !== "LIVE" || finalizable) return { lifecycle: "full_refund", action: "refund" };
    if (localStatus === "placed") return { lifecycle: "awaiting_submission", action: "retry" };
    return { lifecycle: "awaiting_batch", action: null };
  }
  if (outcome === "LIVE") {
    return acceptingOrders
      ? { lifecycle: "active", action: null }
      : { lifecycle: "closed", action: null };
  }
  if (winner) return { lifecycle: "claim_winnings", action: "claim" };
  if (payoutAtomic && payoutAtomic > 0n) return { lifecycle: "recover_collateral", action: "recover" };
  return { lifecycle: "lost", action: null };
}
