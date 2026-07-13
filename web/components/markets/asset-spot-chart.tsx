"use client";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import { TethraChart } from "@/components/app/chart";
import { CHART } from "@/lib/chart-theme";

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export function AssetSpotChart({ asset, strike, height = 200 }: { asset?: string; strike?: number; height?: number }) {
  const { candles, spot, isLoading, isError } = useAssetPrice(asset);

  if (isError || (!isLoading && candles.length === 0)) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <span className="font-mono text-xs text-muted-foreground">Live price feed unavailable</span>
      </div>
    );
  }

  const prices = candles.map((c) => c.price);
  if (strike && strike > 0) prices.push(strike);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 1;
  const pad = Math.max((max - min) * 0.18, max * 0.0004);

  const markLine =
    strike && strike > 0
      ? {
          silent: true,
          symbol: "none",
          lineStyle: { color: CHART.accent, type: "dashed", width: 1 },
          label: { formatter: "Target", color: CHART.accent, fontFamily: CHART.font, fontSize: 10, position: "insideStartTop" },
          data: [{ yAxis: strike }],
        }
      : undefined;

  const option = {
    grid: { left: 8, right: 56, top: 12, bottom: 24, containLabel: false },
    xAxis: {
      type: "time",
      axisLabel: { color: CHART.muted, fontSize: 10, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      position: "right",
      min: min - pad,
      max: max + pad,
      axisLabel: { color: CHART.muted, fontSize: 10, formatter: (v: number) => fmtUsd(v) },
      splitLine: { show: false },
    },
    tooltip: { valueFormatter: (v: number) => fmtUsd(v) },
    series: [
      {
        type: "line",
        showSymbol: false,
        smooth: true,
        data: candles.map((c) => [c.t, c.price]),
        lineStyle: { color: CHART.fg, width: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(236,234,226,0.16)" },
              { offset: 1, color: "rgba(236,234,226,0)" },
            ],
          },
        },
        markLine,
      },
    ],
  };

  return (
    <div className="relative">
      <div style={{ height }}>
        <TethraChart option={option} />
      </div>
      <div className="absolute left-2 top-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#f0564a" }} />
        live {spot ? fmtUsd(spot.price) : ""}
      </div>
    </div>
  );
}
