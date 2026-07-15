const SCALE = 4294967296;

export function fixedToNumber(fp: bigint): number {
  return Number(fp) / SCALE;
}

export function probFromFixed(fp: bigint): number {
  return Number(fp) / SCALE;
}

export function centsLabel(prob: number | null): string {
  if (prob === null || !Number.isFinite(prob)) return "--";
  const c = prob * 100;
  if (c <= 0) return "0c";
  if (c < 1) return "<1c";
  if (c >= 100) return "100c";
  if (c > 99) return ">99c";
  return `${Math.round(c)}c`;
}

export function outcomeLabel(o: unknown): "YES" | "NO" | "LIVE" {
  if (o === null || o === undefined) return "LIVE";
  let s: string | undefined;
  if (typeof o === "string") s = o;
  else if (Array.isArray(o)) s = o[0];
  else s = (o as { tag?: string }).tag;
  if (s === "Yes") return "YES";
  if (s === "No") return "NO";
  return "LIVE";
}

export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "resolved";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatStrike(n: number): string {
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n > 0) return n.toFixed(4);
  return "0";
}

export function marketQuestion(info: { asset: string; threshold: bigint; expiry: bigint }): string {
  const strike = formatStrike(Number(info.threshold) / 1e14);
  return `Will ${info.asset} be at or above ${strike} at settlement?`;
}

export function marketStrike(info: { asset: string; threshold: bigint; expiry: bigint }): string {
  return String(Number(info.threshold) / 1e14);
}

export function formatAgo(ms: number): string {
  if (!ms) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
