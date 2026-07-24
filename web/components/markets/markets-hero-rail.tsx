"use client";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Boxes } from "lucide-react";
import { Panel } from "@/components/app/app-kit";
import { useMarkets } from "@/lib/markets/registry";

const ACCENT = "#eca8d6";

export function MarketsHeroRail() {
  const market = useMarkets()[0];
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col justify-between gap-6 p-6" >
        <div className="space-y-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${ACCENT}1f`, color: ACCENT }}>
            <ShieldCheck className="h-4 w-4" />
          </span>
          <h3 className="font-display text-xl leading-tight">Private by design</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your side and exact position amount are encrypted inside a public collateral bucket. A threshold committee decrypts only batches of at least two orders.
          </p>
        </div>
        <Link
          href={market ? `/app/market/${market.marketId}` : "/app/create"}
          className="inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 font-mono text-xs uppercase tracking-wider text-background"
          style={{ backgroundColor: ACCENT }}
        >
          {market ? "Place a private bet" : "Create a market"}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </Panel>

      <Panel className="flex items-center gap-4 p-5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground">
          <Boxes className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-medium">How it works</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            LMSR pricing, on-chain oracle settlement, in-browser proving.
          </p>
        </div>
        <Link href="/" className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-foreground">
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </Panel>
    </div>
  );
}
