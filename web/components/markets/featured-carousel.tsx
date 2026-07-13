"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMarketCatalog } from "@/lib/markets/catalog";
import { FeaturedMarket } from "./featured-market";
import { Panel } from "@/components/app/app-kit";
import { cn } from "@/lib/utils";

export function FeaturedCarousel() {
  const { rows, isLoading } = useMarketCatalog();
  const [i, setI] = useState(0);
  const n = rows.length;

  useEffect(() => {
    if (n <= 1) return;
    const id = setInterval(() => setI((p) => (p + 1) % n), 8000);
    return () => clearInterval(id);
  }, [n]);

  if (isLoading && n === 0) {
    return <Panel className="p-6"><div className="h-[360px] animate-pulse rounded bg-white/[0.03]" /></Panel>;
  }
  if (n === 0) {
    return <Panel className="p-10"><p className="text-sm text-muted-foreground">No markets available yet.</p></Panel>;
  }

  const idx = i % n;
  const row = rows[idx];

  return (
    <div className="space-y-4">
      <FeaturedMarket row={row} />
      {n > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setI((idx - 1 + n) % n)} aria-label="Previous market"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5">
            {rows.map((r, k) => (
              <button key={r.id} type="button" onClick={() => setI(k)} aria-label={`Market ${k + 1}`}
                className={cn("h-1.5 rounded-full transition-all", k === idx ? "w-5 bg-foreground" : "w-1.5 bg-white/20")} />
            ))}
          </div>
          <button type="button" onClick={() => setI((idx + 1) % n)} aria-label="Next market"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
