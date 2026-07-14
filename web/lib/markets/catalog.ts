"use client";
import { useMarket } from "@/lib/stellar/use-market";
import { useOrders } from "@/lib/stellar/use-orders";
import { NETWORK } from "@/lib/network";

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
};

export function useMarketCatalog(): { rows: MarketRow[]; isLoading: boolean } {
  const { data, isLoading } = useMarket();
  const { data: orders } = useOrders();

  const rows: MarketRow[] = data
    ? [
        {
          id: NETWORK.marketId,
          href: "/app/market/main",
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
          orders: orders?.length ?? 0,
        },
      ]
    : [];

  return { rows, isLoading };
}
