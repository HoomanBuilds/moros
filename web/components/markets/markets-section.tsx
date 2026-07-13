"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { useMarket } from "@/lib/stellar/use-market";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/app/app-kit";
import { MarketCard } from "./market-card";
import { cn } from "@/lib/utils";

const TABS = ["All", "Live", "Closed"] as const;
type Tab = (typeof TABS)[number];

export function MarketsSection() {
  const { data } = useMarket();
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");

  const live = data ? data.outcome === "LIVE" : true;
  const liveCount = data ? (live ? 1 : 0) : 0;
  const matchesSearch = data ? data.question.toLowerCase().includes(search.trim().toLowerCase()) : true;
  const matchesTab = tab === "All" || (tab === "Live" ? live : !live);
  const show = matchesSearch && matchesTab;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-3xl tracking-tight">All markets</h2>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex gap-6 border-b border-foreground/10">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 pb-3 font-mono text-xs uppercase tracking-wider transition-colors",
              tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "Live" && liveCount > 0 && (
              <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums">{liveCount}</span>
            )}
          </button>
        ))}
      </div>

      {show ? (
        <div className="flex flex-wrap gap-6">
          <MarketCard />
        </div>
      ) : (
        <EmptyState
          title="No markets here"
          description={search ? "Nothing matches your search." : "No markets in this view yet."}
        />
      )}
    </div>
  );
}
