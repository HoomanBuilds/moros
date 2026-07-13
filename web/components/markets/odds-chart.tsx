"use client";
import { useEffect, useState } from "react";
import { useMarket } from "@/lib/stellar/use-market";
import { appendSample } from "./odds-chart-util";
import { ProbabilityBar } from "./probability-bar";
import { TethraChart } from "@/components/app/chart";
import { CHART } from "@/lib/chart-theme";

const YES = "#16c784";

export function OddsChart() {
  const { data } = useMarket();
  const [series, setSeries] = useState<[number, number][]>([]);
  useEffect(() => {
    if (data) setSeries((s) => appendSample(s, data.probYes * 100, Date.now(), 240));
  }, [data]);

  const yes = data ? Math.round(data.probYes * 100) : null;
  const values = series.map((p) => p[1]);
  const lo = values.length ? Math.round(Math.min(...values)) : null;
  const hi = values.length ? Math.round(Math.max(...values)) : null;

  const option = {
    grid: { left: 40, right: 16, top: 16, bottom: 28 },
    xAxis: { type: "time", axisLabel: { color: CHART.muted } },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { color: CHART.muted, formatter: "{value}%" },
    },
    series: [
      {
        type: "line",
        showSymbol: false,
        smooth: true,
        data: series,
        lineStyle: { color: YES, width: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(22,199,132,0.28)" },
              { offset: 1, color: "rgba(22,199,132,0)" },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: CHART.axis, type: "dashed" },
          data: [{ yAxis: 50 }],
          label: { show: false },
        },
      },
    ],
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-5xl leading-none" style={{ color: YES }}>
            {yes === null ? "--" : `${yes}%`}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            YES · live since open
          </span>
        </div>
        {lo !== null && hi !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            range {lo}% to {hi}%
          </span>
        )}
      </div>
      <ProbabilityBar probYes={data ? data.probYes : null} />
      <div className="h-[300px]">
        <TethraChart option={option} />
      </div>
    </div>
  );
}
