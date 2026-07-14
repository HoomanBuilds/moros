"use client";
import { useParams } from "next/navigation";
import { useMarkets } from "@/lib/markets/registry";
import { MarketProvider } from "@/lib/markets/market-context";
import { MarketHeader } from "@/components/markets/market-header";
import { MetricRow } from "@/components/markets/metric-row";
import { MarketTerminalChart } from "@/components/markets/market-terminal-chart";
import { BetPanel } from "@/components/markets/bet-panel";
import { MarketTabs } from "@/components/markets/market-tabs";

export default function MarketTerminal() {
  const params = useParams();
  const id = String(params.id);
  const markets = useMarkets();
  const entry = markets.find((m) => m.marketId === id) ?? markets.find((m) => m.flagship)!;

  return (
    <MarketProvider marketId={entry.marketId} poolId={entry.poolId}>
      <div className="space-y-6">
        <MarketHeader />
        <MetricRow />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.9fr_1fr] lg:items-start">
          <MarketTerminalChart />
          <BetPanel />
        </div>
        <MarketTabs />
      </div>
    </MarketProvider>
  );
}
