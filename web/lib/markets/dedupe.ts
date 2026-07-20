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
  protocolVersion?: 2 | 3;
  title?: string;
  category?: string;
  subject?: string;
  bannerUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolverType?: "price" | "event";
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
  rulesHash?: string;
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
