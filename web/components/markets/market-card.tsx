"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel, Tag } from "@/components/app/app-kit";
import { ProbabilityBar } from "@/components/markets/probability-bar";
import { FavoriteStar } from "@/components/markets/favorite-star";
import { getMarketMeta, type MarketMeta } from "@/lib/supabase/markets-meta";
import type { MarketRow } from "@/lib/markets/catalog";

export function MarketCard({ row }: { row: MarketRow }) {
  const [meta, setMeta] = useState<MarketMeta | null>(null);
  const title = meta?.title || row.question;

  useEffect(() => {
    getMarketMeta(row.id).then(setMeta);
  }, [row.id]);

  return (
    <div className="relative w-full sm:w-[380px]">
      <Link href={row.href} className="block">
        <Panel className="space-y-5 p-6 transition-colors hover:border-white/20">
          {meta?.banner_url && <img src={meta.banner_url} alt="" className="h-28 w-full rounded object-cover" />}
          <div className="flex items-center justify-between">
            <Tag>{row.outcome}</Tag>
            <span className="pr-8 font-mono text-xs text-muted-foreground">{row.resolutionLabel}</span>
          </div>
          <h3 className="min-h-[3.5rem] font-display text-2xl leading-snug">{title}</h3>
          <ProbabilityBar probYes={row.probYes} />
          <div className="flex items-end justify-between border-t border-white/[0.08] pt-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Yes</div>
              <div className="font-display text-4xl text-[#16c784]">{row.yesCents === null ? "--" : `${row.yesCents}c`}</div>
            </div>
            <div className="text-right font-mono text-xs text-muted-foreground">
              <div>{row.orders} shielded</div>
              <div className="mt-1">{row.poolXlm.toFixed(2)} XLM pool</div>
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
