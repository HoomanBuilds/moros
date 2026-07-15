"use client";
import type { ReactNode } from "react";
import { useMarket } from "@/lib/stellar/use-market";
import { useOrders } from "@/lib/stellar/use-orders";
import { formatStrike, centsLabel } from "@/lib/stellar/derive";
import { Panel } from "@/components/app/app-kit";

const YES = "#16c784";
const NO = "#f0564a";

function Metric({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-lg tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function MetricRow() {
  const { data } = useMarket();
  const { data: orders } = useOrders();
  const py = data ? data.probYes : null;
  return (
    <Panel className="grid grid-cols-2 divide-x divide-y divide-foreground/10 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
      <Metric label="Yes price" value={centsLabel(py)} color={YES} />
      <Metric label="No price" value={centsLabel(py === null ? null : 1 - py)} color={NO} />
      <Metric label="Pool collateral" value={data ? `${data.poolSizeXlm.toFixed(2)}` : "--"} />
      <Metric label="Shielded orders" value={orders ? orders.length : "--"} />
      <Metric label="Settles in" value={data ? data.resolutionLabel : "--"} />
      <Metric label="Settles at" value={data ? formatStrike(Number(data.strike)) : "--"} />
    </Panel>
  );
}
