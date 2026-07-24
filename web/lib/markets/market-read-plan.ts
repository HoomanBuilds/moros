export type MarketReadPlan = {
  balanceOwner: string;
  feeSource: "private-registration";
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
  if (!liquidityVaultId || !poolId) {
    throw new Error("Market is not part of the current private deployment");
  }
  return {
    balanceOwner: marketId,
    feeSource: "private-registration",
  };
}
