export type MarketEntry = {
  marketId: string;
  poolId: string;
  asset: string;
  kind: "shielded";
  collateralCode?: string;
  collateralIssuer?: string | null;
  collateralSac?: string;
  collateralDecimals?: number;
  flagship?: boolean;
  createdAt?: number;
};

export function dedupeMarkets(entries: MarketEntry[]): MarketEntry[] {
  const seen = new Set<string>();
  const out: MarketEntry[] = [];
  for (const m of entries) {
    if (!m.marketId || seen.has(m.marketId)) continue;
    seen.add(m.marketId);
    out.push(m);
  }
  return out;
}
