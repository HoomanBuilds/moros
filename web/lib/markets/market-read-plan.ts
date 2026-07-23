export type MarketReadPlan = {
  balanceOwner: string;
  feeSource: "legacy-pool" | "private-registration";
};

export function marketReadPlan({
  marketId,
  poolId,
  liquidityVaultId,
}: {
  marketId: string;
  poolId: string;
  liquidityVaultId?: string;
}): MarketReadPlan {
  return liquidityVaultId
    ? {
        balanceOwner: marketId,
        feeSource: "private-registration",
      }
    : {
        balanceOwner: poolId,
        feeSource: "legacy-pool",
      };
}
