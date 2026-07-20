"use client";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import { Panel } from "@/components/app/app-kit";
import { AssetIcon } from "./asset-icon";
import { AssetSpotChart } from "./asset-spot-chart";
import { FavoriteStar } from "./favorite-star";
import { BRAND } from "@/lib/brand";
import type { MarketRow } from "@/lib/markets/catalog";

const YES = "#16c784";
const NO = "#f0564a";

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function SideBet({ href, label, cents, mult, color }: { href: string; label: string; cents: number | null; mult: number | null; color: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md border px-4 py-3 transition-colors hover:bg-white/[0.04]"
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

export function FeaturedMarket({ row }: { row: MarketRow }) {
  const { spot } = useAssetPrice(row.asset);
  const yesMult = row.probYes && row.probYes > 0 ? 1 / row.probYes : null;
  const noMult = row.probYes !== null && row.probYes < 1 ? 1 / (1 - row.probYes) : null;
  const delta = spot && row.strikeNum > 0 ? spot.price - row.strikeNum : null;

  return (
    <Panel className="overflow-hidden">
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
          <Link href={row.href} className="flex min-w-0 items-center gap-3">
            <AssetIcon asset={row.asset} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl leading-tight">{row.question}</h2>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{row.asset} binary market</p>
            </div>
          </Link>

          <div className="flex items-start gap-8">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Strike price</span>
              <span className="font-mono text-lg tabular-nums">{fmtUsd(row.strikeNum)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Current price</span>
              <span className="font-mono text-lg tabular-nums">{spot ? fmtUsd(spot.price) : "--"}</span>
              {delta !== null && Math.abs(delta) >= 0.0001 && (
                <span className="flex items-center gap-0.5 font-mono text-xs" style={{ color: delta >= 0 ? YES : NO }}>
                  {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {delta >= 0 ? "+" : "-"}{fmtUsd(Math.abs(delta))} vs strike
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: row.live ? NO : undefined }}>
                {row.live ? "Ends in" : "Status"}
              </span>
              <span className="font-mono text-lg tabular-nums">{row.live ? row.resolutionLabel : `Resolved ${row.outcome}`}</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,260px)_1fr]">
          <div className="flex flex-col gap-3">
            <SideBet href={row.href} label="Yes" cents={row.yesCents} mult={yesMult} color={YES} />
            <SideBet href={row.href} label="No" cents={row.yesCents === null ? null : 100 - row.yesCents} mult={noMult} color={NO} />
            <div className="mt-auto rounded-md border border-white/[0.08] p-4">
              <p className="font-mono text-xs text-muted-foreground">{row.orders} shielded orders</p>
              <p className="mt-1 text-xs text-muted-foreground">Which way you bet stays private.</p>
            </div>
          </div>
          <AssetSpotChart asset={row.asset} strike={row.strikeNum} height={240} />
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.08] pt-4">
          <span className="font-mono text-xs text-muted-foreground">{row.poolSize.toFixed(2)} {row.collateralCode} pool</span>
          <div className="flex items-center gap-4">
            <FavoriteStar id={row.id} />
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{BRAND.name}</span>
          </div>
        </footer>
      </div>
    </Panel>
  );
}
