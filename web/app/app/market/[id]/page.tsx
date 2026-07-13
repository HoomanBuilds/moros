"use client";
import { Panel } from "@/components/app/app-kit";
import { MarketHeader } from "@/components/markets/market-header";
import { MetricRow } from "@/components/markets/metric-row";
import { OddsChart } from "@/components/markets/odds-chart";
import { BetPanel } from "@/components/markets/bet-panel";
import { MarketTabs } from "@/components/markets/market-tabs";

export default function MarketTerminal() {
  return (
    <div className="space-y-8">
      <MarketHeader />
      <MetricRow />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.9fr_1fr] lg:items-start">
        <Panel className="p-6">
          <OddsChart />
        </Panel>
        <BetPanel />
      </div>
      <MarketTabs />
    </div>
  );
}
