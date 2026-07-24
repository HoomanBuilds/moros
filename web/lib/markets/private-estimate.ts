export function estimatePrivateProfit({
  quantity,
  lotSize,
  sideProbability,
  yesProbability,
  feeBps,
}: {
  quantity: number;
  lotSize: number;
  sideProbability: number;
  yesProbability: number;
  feeBps: number;
}): { grossProfit: number; fee: number; netProfit: number } | null {
  if (
    !Number.isFinite(quantity)
    || !Number.isFinite(lotSize)
    || !Number.isFinite(sideProbability)
    || !Number.isFinite(yesProbability)
    || !Number.isFinite(feeBps)
    || quantity <= 0
    || lotSize <= 0
    || sideProbability < 0
    || sideProbability > 1
    || yesProbability < 0
    || yesProbability > 1
    || feeBps < 0
  ) {
    return null;
  }
  const grossProfit = quantity * lotSize * (1 - sideProbability);
  const fee = quantity
    * lotSize
    * (feeBps / 10_000)
    * yesProbability
    * (1 - yesProbability);
  return {
    grossProfit,
    fee,
    netProfit: Math.max(0, grossProfit - fee),
  };
}
