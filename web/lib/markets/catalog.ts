"use client";
import { useQueries } from "@tanstack/react-query";
import { fetchMarket } from "@/lib/stellar/use-market";
import { getRecentOrders } from "@/lib/stellar/events";
import { useMarkets, type MarketEntry } from "./registry";
import { collateralForEntry } from "./market-context";

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

async function fetchRow(entry: MarketEntry): Promise<MarketRow> {
  const collateral = collateralForEntry(entry);
  const [data, orders] = await Promise.all([
    fetchMarket(entry.marketId, entry.poolId, collateral, entry),
    getRecentOrders(30, entry.poolId).catch(() => []),
  ]);
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
    orders: orders.length,
    flagship: !!entry.flagship,
  };
}

export function useMarketCatalog(): { rows: MarketRow[]; isLoading: boolean } {
  const markets = useMarkets();
  const results = useQueries({
    queries: markets.map((m) => ({
      queryKey: ["market-row", m.marketId],
      refetchInterval: 20000,
      retry: 1,
      queryFn: () => fetchRow(m),
    })),
  });
  const rows = results.map((r) => r.data).filter(Boolean) as MarketRow[];
  const isLoading = results.length > 0 && results.every((r) => r.isLoading);
  return { rows, isLoading };
}
