"use client";
import { useMemo } from "react";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import type { Candle } from "@/lib/prices/asset-price";

const PAD = { top: 12, bottom: 20, left: 2, right: 15 };

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function build(candles: Candle[], strike?: number) {
  const prices = candles.map((c) => c.price);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const range = pMax - pMin || pMax * 0.002 || 1;
  const pad = range * 0.18;
  const min = pMin - pad;
  const max = pMax + pad;
  const span = max - min || 1;

  const xFor = (i: number) =>
    PAD.left + (candles.length <= 1 ? (100 - PAD.left - PAD.right) / 2 : (i / (candles.length - 1)) * (100 - PAD.left - PAD.right));
  const yFor = (price: number) => PAD.top + (1 - (price - min) / span) * (100 - PAD.top - PAD.bottom);

  const pts = candles.map((c, i) => ({ x: xFor(i), y: yFor(c.price) }));
  const line = smoothPath(pts);
  const right = 100 - PAD.right;
  const bottom = 100 - PAD.bottom;
  const area = pts.length ? `${line} L${right},${bottom} L${PAD.left},${bottom} Z` : "";

  const labels = [max - span * 0.02, (max + min) / 2, min + span * 0.02].map((p) => ({ price: p, top: yFor(p) }));
  const times = [0, Math.floor(candles.length / 2), candles.length - 1]
    .filter((i, idx, a) => a.indexOf(i) === idx && candles[i])
    .map((i) => ({ x: xFor(i), t: candles[i].t }));

  let target: { top: number; clamped: "above" | "below" | null } | null = null;
  if (strike && strike > 0) {
    const rawTop = yFor(strike);
    const topClamp = PAD.top;
    const botClamp = 100 - PAD.bottom;
    const clamped = rawTop < topClamp ? "above" : rawTop > botClamp ? "below" : null;
    target = { top: Math.max(topClamp, Math.min(botClamp, rawTop)), clamped };
  }

  return { line, area, labels, times, target };
}

export function AssetSpotChart({ asset, strike, height = 220 }: { asset?: string; strike?: number; height?: number }) {
  const { candles, spot, isLoading, isError } = useAssetPrice(asset);
  const model = useMemo(() => (candles.length ? build(candles, strike) : null), [candles, strike]);

  if (isError || (!isLoading && candles.length === 0)) {
    return (
      <div className="flex items-center justify-center rounded-md border border-white/[0.06]" style={{ height }}>
        <span className="font-mono text-xs text-muted-foreground">Live price feed unavailable</span>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-md" style={{ height }}>
      {model && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="spot-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(236,234,226,0.20)" />
              <stop offset="100%" stopColor="rgba(236,234,226,0)" />
            </linearGradient>
          </defs>
          {model.area && <path d={model.area} fill="url(#spot-fill)" />}
          {model.line && (
            <path d={model.line} fill="none" stroke="#ECEAE2" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      )}

      <div className="absolute left-3 top-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#f0564a" }} />
        live {spot ? fmtUsd(spot.price) : ""}
      </div>

      {model?.labels.map((l, i) => (
        <span
          key={i}
          className="pointer-events-none absolute right-2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground"
          style={{ top: `${l.top}%` }}
        >
          {fmtUsd(l.price)}
        </span>
      ))}

      {model?.target && !model.target.clamped && (
        <div className="pointer-events-none absolute -translate-y-1/2" style={{ top: `${model.target.top}%`, left: `${PAD.left}%`, right: `${PAD.right}%` }}>
          <div className="border-t border-dashed" style={{ borderColor: "#eca8d6" }} />
          <span className="absolute -top-4 right-0 font-mono text-[10px]" style={{ color: "#eca8d6" }}>
            Target {strike ? fmtUsd(strike) : ""}
          </span>
        </div>
      )}

      {model?.target?.clamped && (
        <span
          className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border px-2 py-0.5 font-mono text-[10px]"
          style={{ color: "#eca8d6", borderColor: "#eca8d655" }}
        >
          Target {strike ? fmtUsd(strike) : ""} ({model.target.clamped} range)
        </span>
      )}

      {model && model.times.length > 0 && (
        <div className="pointer-events-none absolute bottom-1 left-3 flex justify-between font-mono text-[10px] text-muted-foreground" style={{ right: `${PAD.right}%` }}>
          {model.times.map((tm, i) => (
            <span key={i}>{fmtTime(tm.t)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
