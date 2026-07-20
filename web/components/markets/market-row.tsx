"use client";
import Link from "next/link";
import { Panel } from "@/components/app/app-kit";
import { AssetIcon } from "./asset-icon";
import { ProbabilityBar } from "./probability-bar";
import { FavoriteStar } from "./favorite-star";
import type { MarketRow } from "@/lib/markets/catalog";

export function MarketListRow({ row }: { row: MarketRow }) {
  return (
    <div className="relative">
      <Link href={row.href} className="block">
        <Panel className="flex items-center gap-4 p-4 pr-12 transition-colors hover:border-white/20">
          <AssetIcon asset={row.asset} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{row.question}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {row.live ? `settles in ${row.resolutionLabel}` : `resolved ${row.outcome}`}
            </div>
          </div>
          <div className="hidden w-40 md:block">
            <ProbabilityBar probYes={row.probYes} showLabels={false} />
          </div>
          <div className="w-14 text-right">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">yes</div>
            <div className="font-mono text-sm text-[#16c784]">{row.yesCents === null ? "--" : `${row.yesCents}c`}</div>
          </div>
          <div className="hidden w-24 text-right lg:block">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">pool</div>
            <div className="font-mono text-sm">{row.poolSize.toFixed(2)} {row.collateralCode}</div>
          </div>
          <div className="hidden w-16 text-right lg:block">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">orders</div>
            <div className="font-mono text-sm">{row.orders}</div>
          </div>
        </Panel>
      </Link>
      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        <FavoriteStar id={row.id} />
      </div>
    </div>
  );
}
