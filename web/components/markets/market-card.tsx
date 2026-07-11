"use client";
import Link from "next/link";
import { useMarket } from "@/lib/stellar/use-market";
import { Panel, Tag } from "@/components/app/app-kit";

export function MarketCard() {
  const { data, isLoading } = useMarket();
  const yes = data ? Math.round(data.probYes * 100) : null;
  return (
    <Link href="/app/market/main">
      <Panel className="p-6 hover:border-foreground/30 transition-colors">
        <div className="flex items-center justify-between">
          <Tag>{data ? data.outcome : "..."}</Tag>
          <span className="font-mono text-xs text-muted-foreground">
            {data ? data.resolutionLabel : ""}
          </span>
        </div>
        <h3 className="font-display text-2xl mt-4 min-h-[3.5rem]">
          {isLoading ? "Loading market..." : (data?.question ?? "Market unavailable")}
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
  );
}
