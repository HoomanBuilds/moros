export function calculateExecutedPositionAmounts({
  positionBudget,
  quantity,
  chargePerUnit,
  feePerUnit,
  payoutPerUnit,
  winner,
  voided,
}: {
  positionBudget: bigint;
  quantity: bigint;
  chargePerUnit: bigint;
  feePerUnit: bigint;
  payoutPerUnit: bigint;
  winner: boolean;
  voided: boolean;
}): { changeAmount: bigint; terminalAmount: bigint } {
  if (quantity <= 0n || quantity > 1_000n) {
    throw new Error("Private position quantity is invalid");
  }
  const spent = (chargePerUnit + feePerUnit) * quantity;
  const changeAmount = positionBudget - spent;
  if (changeAmount < 0n) {
    throw new Error("Private position budget is below its batch charge");
  }
  return {
    changeAmount,
    terminalAmount: winner
      ? payoutPerUnit * quantity
      : voided
        ? spent
        : 0n,
  };
}
