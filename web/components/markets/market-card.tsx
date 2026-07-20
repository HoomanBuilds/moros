"use client";
import Link from "next/link";
import { Panel, Tag } from "@/components/app/app-kit";
import { ProbabilityBar } from "@/components/markets/probability-bar";
import { FavoriteStar } from "@/components/markets/favorite-star";
import { centsLabel } from "@/lib/stellar/derive";
import { MarketBanner, MarketVisual } from "@/components/markets/market-visual";
import type { MarketRow } from "@/lib/markets/catalog";

export function MarketCard({ row }: { row: MarketRow }) {
  return (
    <div className="relative w-full sm:w-[380px]">
      <Link href={row.href} className="block">
        <Panel className="space-y-5 p-6 transition-colors hover:border-white/20">
          {row.resolverType === "event" && (
            <MarketBanner
              category={row.category}
              subject={row.subject}
              question={row.question}
              imageUrl={row.bannerUrl}
              className="h-32"
            />
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <MarketVisual
                resolverType={row.resolverType}
                asset={row.asset}
                category={row.category}
                subject={row.subject}
                imageUrl={row.bannerUrl}
                size="sm"
              />
              <Tag>{row.outcome}</Tag>
            </div>
            <span className="pr-8 font-mono text-xs text-muted-foreground">{row.resolutionLabel}</span>
          </div>
          <div>
            {row.resolverType === "event" && (
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                {row.subject || row.category || "Event"}
              </p>
            )}
            <h3 className="min-h-[3.5rem] font-display text-2xl leading-snug">{row.question}</h3>
          </div>
          <ProbabilityBar probYes={row.probYes} />
          <div className="flex items-end justify-between border-t border-white/[0.08] pt-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Yes</div>
              <div className="font-display text-4xl text-[#16c784]">{centsLabel(row.probYes)}</div>
            </div>
            <div className="text-right font-mono text-xs text-muted-foreground">
              <div>{row.orders} shielded</div>
              <div className="mt-1">{row.poolSize.toFixed(2)} {row.collateralCode} pool</div>
            </div>
          </div>
        </Panel>
      </Link>
      <div className="absolute right-5 top-5">
        <FavoriteStar id={row.id} />
      </div>
    </div>
  );
}
