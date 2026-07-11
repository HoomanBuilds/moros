"use client";
import { useMarket } from "@/lib/stellar/use-market";
import { PageHeader, Panel } from "@/components/app/app-kit";
import { StatsStrip } from "@/components/markets/stats-strip";
import { OddsChart } from "@/components/markets/odds-chart";

export default function MarketTerminal() {
  const { data } = useMarket();
  return (
    <div className="space-y-8">
      <PageHeader
        label="Market"
        title={data?.question ?? "Market"}
        description="Read-only - private betting arrives in the next release"
      />
      <StatsStrip />
      <Panel className="p-6">
        <OddsChart />
      </Panel>
    </div>
  );
}
