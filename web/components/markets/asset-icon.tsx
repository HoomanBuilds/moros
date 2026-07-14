"use client";

const COLORS: Record<string, string> = {
  XLM: "#3aa9ff",
  BTC: "#f7931a",
  ETH: "#8a92b2",
  SOL: "#14f195",
  BNB: "#f3ba2f",
  XRP: "#23292f",
  ADA: "#0033ad",
  AVAX: "#e84142",
  LINK: "#2a5ada",
  DOGE: "#c2a633",
  DOT: "#e6007a",
};

const SIZES = { sm: "h-8 w-8 text-[10px]", md: "h-11 w-11 text-xs", lg: "h-14 w-14 text-sm" };

export function AssetIcon({ asset, size = "md" }: { asset?: string; size?: keyof typeof SIZES }) {
  const sym = (asset ?? "?").toUpperCase();
  const color = COLORS[sym] ?? "#eca8d6";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono font-medium tracking-tight ${SIZES[size]}`}
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}55` }}
    >
      {sym.slice(0, 3)}
    </span>
  );
}
