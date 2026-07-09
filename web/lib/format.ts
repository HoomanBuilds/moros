import { DUSDC_DECIMALS, SHARE_DECIMALS } from "./config";

export function fromUnits(raw: bigint | string | number, decimals: number): number {
  return Number(BigInt(raw ?? 0)) / 10 ** decimals;
}
export const fromDusdc = (raw: bigint | string | number) => fromUnits(raw, DUSDC_DECIMALS);
export const fromShares = (raw: bigint | string | number) => fromUnits(raw, SHARE_DECIMALS);

// Precise decimal-string to base-units parse (no float rounding).
export function parseUnits(input: string, decimals: number): bigint {
  const clean = (input || "").trim();
  if (!clean) return 0n;
  const [whole, frac = ""] = clean.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}
export const toDusdc = (input: string) => parseUnits(input, DUSDC_DECIMALS);
export const toShares = (input: string) => parseUnits(input, SHARE_DECIMALS);

export function formatUsd(n: number, max = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  });
}
export function formatNumber(n: number, max = 4): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}
export function formatPercent(fraction: number, max = 2): string {
  return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: max })}%`;
}
export function truncateAddress(a?: string): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
