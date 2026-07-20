"use client";
import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useMarket } from "@/lib/stellar/use-market";
import { FavoriteStar } from "@/components/markets/favorite-star";
import { MarketVisual } from "@/components/markets/market-visual";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK } from "@/lib/network";

const YES = "#16c784";
const NO = "#f0564a";

function StatusPill({ outcome, settles, acceptingOrders }: { outcome?: string; settles?: string; acceptingOrders?: boolean }) {
  if (!outcome) {
    return <span className="font-mono text-xs text-muted-foreground">loading</span>;
  }
  if (outcome === "LIVE" && acceptingOrders) {
    return (
      <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: YES }} />
        Live · settles in {settles}
      </span>
    );
  }
  if (outcome === "LIVE") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-400 px-3 py-1 font-mono text-xs uppercase tracking-wider text-amber-300">
        Closed, resolution pending
      </span>
    );
  }
  const color = outcome === "YES" ? YES : outcome === "VOID" ? "#fbbf24" : NO;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-wider"
      style={{ borderColor: color, color }}
    >
      {outcome === "VOID" ? "Voided, full refunds" : `Resolved ${outcome}`}
    </span>
  );
}

export function MarketHeader() {
  const { data } = useMarket();
  const { marketId } = useActiveMarket();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Markets
        </Link>
        <div className="flex items-center gap-4">
          <a
            href={NETWORK.explorer(marketId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Contract
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <FavoriteStar id={marketId} />
        </div>
      </div>

      <div className="flex items-start gap-4">
        <MarketVisual
          resolverType={data?.resolverType}
          asset={data?.asset}
          category={data?.category}
          subject={data?.subject}
          imageUrl={data?.bannerUrl}
          size="lg"
        />
        <div className="space-y-4">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {data ? `${data.subject || data.category || data.asset} · binary market` : "binary market"}
          </span>
          <h1 className="max-w-3xl font-display text-2xl leading-tight tracking-tight md:text-3xl">
            {data?.question ?? "Loading market"}
          </h1>
          <StatusPill outcome={data?.outcome} settles={data?.resolutionLabel} acceptingOrders={data?.acceptingOrders} />
        </div>
      </div>
    </div>
  );
}
