"use client";
import { useMarket } from "@/lib/stellar/use-market";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import { Panel } from "@/components/app/app-kit";
import { ProbabilityBar } from "./probability-bar";
import { AssetSpotChart } from "./asset-spot-chart";

const YES = "#16c784";

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export function MarketTerminalChart() {
  const { data } = useMarket();
  const isEvent = data?.resolverType === "event";
  const { spot } = useAssetPrice(isEvent ? undefined : data?.asset);
  const yes = data ? Math.round(data.probYes * 100) : null;

  return (
    <Panel className="space-y-5 p-6">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Implied probability</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-5xl leading-none" style={{ color: YES }}>
              {yes === null ? "--" : `${yes}%`}
            </span>
            <span className="font-mono text-xs text-muted-foreground">YES</span>
          </div>
        </div>
        {isEvent ? (
          <div className="text-right">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Category</span>
            <div className="mt-1 font-mono text-sm">{data?.category || "Event"}</div>
          </div>
        ) : (
          <div className="text-right">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{data?.asset ?? "asset"} price</span>
            <div className="mt-1 font-mono text-lg tabular-nums">{spot ? fmtUsd(spot.price) : "--"}</div>
          </div>
        )}
      </div>
      <ProbabilityBar probYes={data ? data.probYes : null} />
      {isEvent ? (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-muted-foreground">
          {data?.resolutionRules || "Resolution criteria are loading."}
        </div>
      ) : (
        <AssetSpotChart asset={data?.asset} strike={data ? Number(data.strike) : undefined} height={300} />
      )}
    </Panel>
  );
}
