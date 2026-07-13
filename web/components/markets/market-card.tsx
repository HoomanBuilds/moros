"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarket } from "@/lib/stellar/use-market";
import { useOrders } from "@/lib/stellar/use-orders";
import { Panel, Tag } from "@/components/app/app-kit";
import { ProbabilityBar } from "@/components/markets/probability-bar";
import { WatchButton } from "@/components/social/watch-button";
import { getMarketMeta, type MarketMeta } from "@/lib/supabase/markets-meta";
import { NETWORK } from "@/lib/network";

export function MarketCard() {
  const { data, isLoading } = useMarket();
  const { data: orders } = useOrders();
  const [meta, setMeta] = useState<MarketMeta | null>(null);
  const yes = data ? Math.round(data.probYes * 100) : null;
  const title = meta?.title || data?.question;

  useEffect(() => {
    getMarketMeta(NETWORK.marketId).then(setMeta);
  }, []);

  return (
    <div className="relative w-full sm:w-[380px]">
      <Link href="/app/market/main" className="block">
        <Panel className="p-6 space-y-5 transition-colors hover:border-foreground/30">
          {meta?.banner_url && (
            <img src={meta.banner_url} alt="" className="w-full h-28 object-cover rounded" />
          )}
          <div className="flex items-center justify-between">
            <Tag>{data ? data.outcome : "..."}</Tag>
            <span className="font-mono text-xs text-muted-foreground pr-8">
              {data ? data.resolutionLabel : ""}
            </span>
          </div>
          <h3 className="font-display text-2xl leading-snug min-h-[3.5rem]">
            {isLoading ? "Loading market..." : (title ?? "Market unavailable")}
          </h3>
          <ProbabilityBar probYes={data ? data.probYes : null} />
          <div className="flex items-end justify-between border-t border-foreground/10 pt-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Yes</div>
              <div className="font-display text-4xl text-[#16c784]">{yes === null ? "--" : `${yes}c`}</div>
            </div>
            <div className="text-right font-mono text-xs text-muted-foreground">
              <div>{orders ? `${orders.length} shielded` : ""}</div>
              <div className="mt-1">{data ? `${data.poolSizeXlm.toFixed(2)} XLM pool` : "--"}</div>
            </div>
          </div>
        </Panel>
      </Link>
      <div className="absolute top-6 right-6">
        <WatchButton marketId={NETWORK.marketId} />
      </div>
    </div>
  );
}
