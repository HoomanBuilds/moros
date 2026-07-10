"use client";

import dynamic from "next/dynamic";
import { applyTheme } from "@/lib/chart-theme";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export function TethraChart({
  option,
  height = 280,
  className = "",
}: {
  option: Record<string, any>;
  height?: number | string;
  className?: string;
}) {
  const fill = typeof height === "string";
  return (
    <div className={className} style={{ width: "100%", height: fill ? "100%" : undefined }}>
      <ReactECharts
        option={applyTheme(option)}
        style={{ height: fill ? height : `${height}px`, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
