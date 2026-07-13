"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useMarket } from "@/lib/stellar/use-market";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import { useOrders } from "@/lib/stellar/use-orders";
import { Panel } from "@/components/app/app-kit";
import { AssetIcon } from "./asset-icon";
import { AssetSpotChart } from "./asset-spot-chart";
import { BRAND } from "@/lib/brand";

const YES = "#16c784";
const NO = "#f0564a";

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function PriceStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{children}</span>
    </div>
  );
}

function SideBet({ label, cents, mult, color }: { label: string; cents: number | null; mult: number | null; color: string }) {
  return (
    <Link
      href="/app/market/main"
      className="flex items-center justify-between rounded-md border px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
      style={{ borderColor: `${color}44` }}
    >
      <span className="font-mono text-sm uppercase tracking-wider" style={{ color }}>{label}</span>
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {cents === null ? "--" : `${cents}c`}
        {mult ? <span className="ml-2" style={{ color }}>{mult.toFixed(2)}x</span> : null}
      </span>
    </Link>
  );
}

export function FeaturedMarket() {
  const { data } = useMarket();
  const { spot } = useAssetPrice(data?.asset);
  const { data: orders } = useOrders();

  const strikeNum = data ? Number(data.strike) : 0;
  const yesCents = data ? Math.round(data.probYes * 100) : null;
  const yesMult = data && data.probYes > 0 ? 1 / data.probYes : null;
  const noMult = data && data.probYes < 1 ? 1 / (1 - data.probYes) : null;
  const delta = spot && strikeNum > 0 ? spot.price - strikeNum : null;
  const live = data ? data.outcome === "LIVE" : false;

  return (
    <Panel className="overflow-hidden">
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <Link href="/app/market/main" className="flex min-w-0 items-center gap-3">
            <AssetIcon asset={data?.asset} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl leading-tight">
                {data?.question ?? "Loading market"}
              </h2>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {data?.asset ?? "--"} binary market
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-8">
            <PriceStat label="Strike price">{data ? fmtUsd(strikeNum) : "--"}</PriceStat>
            <PriceStat label="Current price">
              <span className="flex items-center gap-2">
                {delta !== null && Math.abs(delta) >= 0.0001 && (
                  <span className="flex items-center gap-0.5" style={{ color: delta >= 0 ? YES : NO }}>
                    {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {delta >= 0 ? "+" : "-"}{fmtUsd(Math.abs(delta))}
                  </span>
                )}
                {spot ? fmtUsd(spot.price) : "--"}
              </span>
            </PriceStat>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: live ? NO : undefined }}>
                {live ? "Ends in" : "Status"}
              </span>
              <span className="font-mono text-sm tabular-nums">
                {data ? (live ? data.resolutionLabel : `Resolved ${data.outcome}`) : "--"}
              </span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,260px)_1fr]">
          <div className="flex flex-col gap-3">
            <SideBet label="Yes" cents={yesCents} mult={yesMult} color={YES} />
            <SideBet label="No" cents={yesCents === null ? null : 100 - yesCents} mult={noMult} color={NO} />
            <div className="mt-auto rounded-md border border-foreground/10 p-4">
              <p className="font-mono text-xs text-muted-foreground">
                {orders ? `${orders.length} shielded orders` : "Reading orders"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sides and sizes stay private until redeem.
              </p>
            </div>
          </div>
          <div className="rounded-md border border-foreground/10 p-3">
            <AssetSpotChart asset={data?.asset} strike={strikeNum} height={220} />
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-foreground/10 pt-4">
          <span className="font-mono text-xs text-muted-foreground">
            {data ? `${data.poolSizeXlm.toFixed(2)} XLM pool` : "--"}
          </span>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{BRAND.name}</span>
        </footer>
      </div>
    </Panel>
  );
}
