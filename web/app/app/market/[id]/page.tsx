"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMarketRegistryReady, useMarkets } from "@/lib/markets/registry";
import { collateralForEntry, MarketProvider } from "@/lib/markets/market-context";
import { PageHeader, Panel } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { MarketHeader } from "@/components/markets/market-header";
import { MetricRow } from "@/components/markets/metric-row";
import { MarketTerminalChart } from "@/components/markets/market-terminal-chart";
import { BetPanel } from "@/components/markets/bet-panel";
import { MarketTabs } from "@/components/markets/market-tabs";

export default function MarketTerminal() {
  const params = useParams();
  const id = String(params.id);
  const markets = useMarkets();
  const registryReady = useMarketRegistryReady();
  const entry = markets.find((m) => m.marketId === id);

  if (!entry) {
    return (
      <div className="space-y-6">
        <PageHeader
          label="Moros"
          title={registryReady ? "Market not found" : "Loading market"}
          description={registryReady ? "This market is not present in the public or local registry." : "Checking the market registry."}
        />
        {registryReady && (
          <Panel className="p-6">
            <Button asChild>
              <Link href="/app">Browse markets</Link>
            </Button>
          </Panel>
        )}
      </div>
    );
  }
  const descriptor = {
    title: entry.title,
    category: entry.category,
    resolverType: entry.resolverType,
    resolutionSource: entry.resolutionSource,
    resolutionRules: entry.resolutionRules,
    voidRules: entry.voidRules,
    rulesHash: entry.rulesHash,
  };

  return (
    <MarketProvider marketId={entry.marketId} poolId={entry.poolId} collateral={collateralForEntry(entry)} protocolVersion={entry.protocolVersion} descriptor={descriptor}>
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
