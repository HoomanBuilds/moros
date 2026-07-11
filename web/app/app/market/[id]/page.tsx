"use client";
import { useMarket } from "@/lib/stellar/use-market";
import { PageHeader, Panel } from "@/components/app/app-kit";
import { StatsStrip } from "@/components/markets/stats-strip";
import { OddsChart } from "@/components/markets/odds-chart";
import { BetPanel } from "@/components/markets/bet-panel";

export default function MarketTerminal() {
  const { data } = useMarket();
  return (
    <div className="space-y-8">
      <PageHeader
        label="Market"
        title={data?.question ?? "Market"}
        description="Your position stays hidden until you redeem"
      />
      <StatsStrip />
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <Panel className="p-6">
          <OddsChart />
        </Panel>
        <BetPanel />
      </div>
    </div>
  );
}
