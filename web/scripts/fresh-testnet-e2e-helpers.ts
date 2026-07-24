export type FreshBettorName = "alice" | "charlie";
export type FreshOutcome = "LIVE" | "YES" | "NO" | "VOID";

export function atomicStellarAmount(
  amount: bigint,
  scale = 10_000_000n,
): string {
  if (amount <= 0n || scale <= 1n) {
    throw new Error("Testnet transfer amount must be positive");
  }
  const decimals = scale.toString().length - 1;
  if (10n ** BigInt(decimals) !== scale) {
    throw new Error("Testnet transfer scale must be a power of ten");
  }
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

export function freshOrderSigner(
  signer?: FreshBettorName,
): FreshBettorName {
  return signer ?? "charlie";
}

export function freshPositionResult(
  side: 0 | 1,
  outcome: FreshOutcome,
): "winner" | "loser" | null {
  if (outcome !== "YES" && outcome !== "NO") return null;
  return (
    (side === 1 && outcome === "YES")
    || (side === 0 && outcome === "NO")
  )
    ? "winner"
    : "loser";
}
