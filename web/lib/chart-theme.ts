// Tethra ECharts theme. Approximates the globals.css oklch palette in hex so the
// canvas renders on-brand: transparent background, hairline dashed grid, pink
// #eca8d6 accent, monospace tick labels, no chartjunk.

export const CHART = {
  fg: "#ECEAE2",
  fgDim: "rgba(236,234,226,0.55)",
  muted: "#8B867C",
  accent: "#eca8d6",
  accentSoft: "rgba(236,168,214,0.18)",
  accentFaint: "rgba(236,168,214,0.04)",
  grid: "rgba(236,234,226,0.07)",
  axis: "rgba(236,234,226,0.15)",
  destructive: "#d98a8a",
  font: "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace",
};

type AnyObj = Record<string, any>;

function themeAxis(axis: AnyObj | AnyObj[]): AnyObj | AnyObj[] {
  const base: AnyObj = {
    axisLine: { lineStyle: { color: CHART.axis } },
    axisTick: { show: false },
    axisLabel: { color: CHART.muted, fontFamily: CHART.font, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: CHART.grid, type: "dashed" } },
    nameTextStyle: { color: CHART.muted, fontFamily: CHART.font },
  };
  const merge = (a: AnyObj) => ({
    ...base,
    ...a,
    axisLabel: { ...base.axisLabel, ...(a?.axisLabel ?? {}) },
    splitLine: { ...base.splitLine, ...(a?.splitLine ?? {}) },
  });
  return Array.isArray(axis) ? axis.map(merge) : merge(axis ?? {});
}

// Merges a page option with the themed defaults.
export function applyTheme(option: AnyObj): AnyObj {
  return {
    backgroundColor: "transparent",
    color: [CHART.accent, CHART.fg, CHART.muted],
    textStyle: { fontFamily: CHART.font, color: CHART.fg },
    animationDuration: 600,
    ...option,
    grid: {
      left: 8,
      right: 18,
      top: 18,
      bottom: 8,
      containLabel: true,
      ...(option.grid ?? {}),
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(9,9,11,0.95)",
      borderColor: "rgba(236,234,226,0.12)",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: CHART.fg, fontFamily: CHART.font, fontSize: 12 },
      ...(option.tooltip ?? {}),
    },
    legend: option.legend
      ? {
          textStyle: { color: CHART.muted, fontFamily: CHART.font, fontSize: 11 },
          icon: "roundRect",
          itemWidth: 10,
          itemHeight: 10,
          ...option.legend,
        }
      : undefined,
    xAxis: option.xAxis ? themeAxis(option.xAxis) : undefined,
    yAxis: option.yAxis ? themeAxis(option.yAxis) : undefined,
  };
}
