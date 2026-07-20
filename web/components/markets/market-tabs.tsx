"use client";
import { useState } from "react";
import { useOrders } from "@/lib/stellar/use-orders";
import { ActivityFeed } from "./activity-feed";
import { AboutPanel } from "./about-panel";
import { PositionsList } from "@/components/portfolio/positions-list";
import { Comments } from "@/components/social/comments";
import { useActiveMarket } from "@/lib/markets/market-context";
import { cn } from "@/lib/utils";
import { ResolutionPanel } from "./resolution-panel";
import { useMarket } from "@/lib/stellar/use-market";

type TabKey = "activity" | "positions" | "resolution" | "about" | "comments";

export function MarketTabs() {
  const [tab, setTab] = useState<TabKey>("activity");
  const { data: orders } = useOrders();
  const { marketId } = useActiveMarket();
  const { data: market } = useMarket();

  const tabs: { key: TabKey; label: string }[] = [
    { key: "activity", label: `Activity${orders ? ` (${orders.length})` : ""}` },
    { key: "positions", label: "Your positions" },
    ...(market?.resolverType === "event" ? [{ key: "resolution" as const, label: "Resolution" }] : []),
    { key: "about", label: "About" },
    { key: "comments", label: "Comments" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 border-b border-foreground/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 pb-3 font-mono text-xs uppercase tracking-wider transition-colors",
              tab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "activity" && <ActivityFeed />}
      {tab === "positions" && <PositionsList />}
      {tab === "resolution" && <ResolutionPanel />}
      {tab === "about" && <AboutPanel />}
      {tab === "comments" && <Comments marketId={marketId} />}
    </div>
  );
}
