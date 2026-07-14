"use client";
import { useQueries } from "@tanstack/react-query";
import { fetchMarket } from "@/lib/stellar/use-market";
import { getRecentOrders } from "@/lib/stellar/events";
import { useMarkets, type MarketEntry } from "./registry";

export type MarketRow = {
  id: string;
  href: string;
  asset: string;
  question: string;
  strike: string;
  strikeNum: number;
  probYes: number | null;
  yesCents: number | null;
  outcome: "YES" | "NO" | "LIVE";
  live: boolean;
  resolutionLabel: string;
  secondsLeft: number;
  poolXlm: number;
  orders: number;
  flagship: boolean;
};

async function fetchRow(entry: MarketEntry): Promise<MarketRow> {
  const [data, orders] = await Promise.all([
    fetchMarket(entry.marketId, entry.poolId),
    getRecentOrders(30, entry.poolId).catch(() => []),
  ]);
  return {
    id: entry.marketId,
    href: `/app/market/${entry.marketId}`,
    asset: data.asset,
    question: data.question,
    strike: data.strike,
    strikeNum: Number(data.strike),
    probYes: data.probYes,
    yesCents: Math.round(data.probYes * 100),
    outcome: data.outcome,
    live: data.outcome === "LIVE",
    resolutionLabel: data.resolutionLabel,
    secondsLeft: data.secondsLeft,
    poolXlm: data.poolSizeXlm,
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
