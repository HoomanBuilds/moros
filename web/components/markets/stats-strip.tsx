"use client";
import { useMarket } from "@/lib/stellar/use-market";
import { StatCard } from "@/components/app/app-kit";

export function StatsStrip() {
  const { data } = useMarket();
  const yes = data ? Math.round(data.probYes * 100) : null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="YES price" value={yes === null ? "--" : `${yes}c`} />
      <StatCard label="NO price" value={yes === null ? "--" : `${100 - yes}c`} />
      <StatCard label="Pool size" value={data ? `${data.poolSize.toFixed(2)} ${data.collateral.code}` : "--"} />
      <StatCard label="Resolution" value={data ? data.resolutionLabel : "--"} />
    </div>
  );
}
