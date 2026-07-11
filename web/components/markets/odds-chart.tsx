"use client";
import { useEffect, useState } from "react";
import { useMarket } from "@/lib/stellar/use-market";
import { appendSample } from "./odds-chart-util";
import { TethraChart } from "@/components/app/chart";
import { CHART } from "@/lib/chart-theme";

export function OddsChart() {
  const { data } = useMarket();
  const [series, setSeries] = useState<[number, number][]>([]);
  useEffect(() => {
    if (data) setSeries((s) => appendSample(s, data.probYes * 100, Date.now(), 120));
  }, [data]);
  const option = {
    grid: { left: 40, right: 16, top: 20, bottom: 30 },
    xAxis: { type: "time", axisLabel: { color: CHART.muted } },
    yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: CHART.muted, formatter: "{value}%" } },
    series: [{ type: "line", showSymbol: false, smooth: true, data: series, lineStyle: { color: "#16c784" } }],
  };
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-5xl text-[#16c784]">
          {data ? `${Math.round(data.probYes * 100)}%` : "--"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">YES - live since open</span>
      </div>
      <div className="mt-4 h-[280px]">
        <TethraChart option={option} />
      </div>
    </div>
  );
}
