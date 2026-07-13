"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarket } from "@/lib/stellar/use-market";
import { Panel, Tag } from "@/components/app/app-kit";
import { WatchButton } from "@/components/social/watch-button";
import { getMarketMeta, type MarketMeta } from "@/lib/supabase/markets-meta";
import { NETWORK } from "@/lib/network";

export function MarketCard() {
  const { data, isLoading } = useMarket();
  const [meta, setMeta] = useState<MarketMeta | null>(null);
  const yes = data ? Math.round(data.probYes * 100) : null;
  const title = meta?.title || data?.question;

  useEffect(() => {
    getMarketMeta(NETWORK.marketId).then(setMeta);
  }, []);

  return (
    <div className="relative">
      <Link href="/app/market/main" className="block">
        <Panel className="p-6 hover:border-foreground/30 transition-colors">
          {meta?.banner_url && (
            <img src={meta.banner_url} alt="" className="w-full h-28 object-cover rounded mb-4" />
          )}
          <div className="flex items-center justify-between">
            <Tag>{data ? data.outcome : "..."}</Tag>
            <span className="font-mono text-xs text-muted-foreground pr-8">
              {data ? data.resolutionLabel : ""}
            </span>
          </div>
          <h3 className="font-display text-2xl mt-4 min-h-[3.5rem]">
            {isLoading ? "Loading market..." : (title ?? "Market unavailable")}
          </h3>
          <div className="flex items-end justify-between mt-6">
            <div>
              <div className="font-mono text-xs text-muted-foreground">YES</div>
              <div className="font-display text-4xl text-[#16c784]">{yes === null ? "--" : `${yes}c`}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xs text-muted-foreground">pool</div>
              <div className="font-mono text-sm">{data ? `${data.poolSizeXlm.toFixed(2)} XLM` : "--"}</div>
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
