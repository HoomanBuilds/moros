"use client";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMarket,
  marketFromPrivateCatalog,
} from "@/lib/stellar/use-market";
import {
  useMarketRegistryReady,
  useMarkets,
  type MarketEntry,
} from "./registry";
import { collateralForEntry } from "./market-context";
import {
  getPrivateMarketCatalog,
  type PrivateMarketCatalogEntry,
} from "@/lib/private/client";

export type MarketRow = {
  id: string;
  href: string;
  asset: string;
  category?: string;
  subject?: string;
  bannerUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolverType: "price" | "event";
  resolutionRules?: string;
  question: string;
  strike: string;
  strikeNum: number;
  probYes: number | null;
  yesCents: number | null;
  outcome: "YES" | "NO" | "VOID" | "LIVE";
  live: boolean;
  resolutionLabel: string;
  secondsLeft: number;
  poolSize: number;
  collateralCode: string;
  orders: number;
  flagship: boolean;
};

async function fetchRow(
  entry: MarketEntry,
  snapshot?: PrivateMarketCatalogEntry,
): Promise<MarketRow> {
  const collateral = collateralForEntry(entry);
  const data = snapshot && entry.resolverType !== "event"
    ? marketFromPrivateCatalog(snapshot, collateral, entry)
    : await fetchMarket(
        entry.marketId,
        entry.poolId,
        collateral,
        entry,
      );
  return {
    id: entry.marketId,
    href: `/app/market/${entry.marketId}`,
    asset: data.asset,
    category: data.category,
    subject: data.subject,
    bannerUrl: data.bannerUrl,
    bannerSourceUrl: data.bannerSourceUrl,
    bannerAttribution: data.bannerAttribution,
    bannerLicense: data.bannerLicense,
    bannerLicenseUrl: data.bannerLicenseUrl,
    resolverType: data.resolverType,
    resolutionRules: data.resolutionRules,
    question: data.question,
    strike: data.strike,
    strikeNum: Number(data.strike),
    probYes: data.probYes,
    yesCents: Math.round(data.probYes * 100),
    outcome: data.outcome,
    live: data.acceptingOrders,
    resolutionLabel: data.resolutionLabel,
    secondsLeft: data.secondsLeft,
    poolSize: data.poolSize,
    collateralCode: collateral.code,
    orders: data.orderCount,
    flagship: !!entry.flagship,
  };
}

export function useMarketCatalog(): { rows: MarketRow[]; isLoading: boolean } {
  const markets = useMarkets();
  const registryReady = useMarketRegistryReady();
  const marketKey = markets.map((market) => [
    market.marketId,
    market.poolId,
    market.liquidityVaultId ?? "missing-private-vault",
  ]);
  const result = useQuery({
    queryKey: ["market-catalog", marketKey],
    enabled: markets.length > 0,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      let snapshotByMarket = new Map<string, PrivateMarketCatalogEntry>();
      try {
        const snapshot = await getPrivateMarketCatalog();
        snapshotByMarket = new Map(
          snapshot.markets.map((entry) => [entry.market, entry]),
        );
      } catch {
        // The direct read fallback keeps the page available during rollout.
      }
      const rows = await Promise.allSettled(markets.map((market) =>
        fetchRow(market, snapshotByMarket.get(market.marketId))
      ));
      return rows.flatMap((row) =>
        row.status === "fulfilled" ? [row.value] : []
      );
    },
  });
  return {
    rows: result.data ?? [],
    isLoading: !registryReady || result.isLoading,
  };
}
