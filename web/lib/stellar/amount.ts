export function parseBalanceAmount(value: string, decimals: number): bigint {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(input)) throw new Error("Enter a valid amount");
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const atomic = parseBalanceAmount(value, decimals);
  if (atomic <= 0n) throw new Error("Amount must be greater than zero");
  return atomic;
}

export function formatTokenAmount(value: bigint, decimals: number, maximumFractionDigits = 2): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").slice(0, maximumFractionDigits).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function parseWholeOrderAmount(value: string, decimals: number): { orderAmount: string; atomic: bigint } {
  const input = value.trim();
  if (!/^\d+$/.test(input)) throw new Error("Orders currently use whole collateral units");
  const atomic = parseTokenAmount(input, decimals);
  return { orderAmount: BigInt(input).toString(), atomic };
}

export function parsePrivatePositionQuantity(value: string): bigint {
  const input = value.trim();
  if (!/^\d+$/.test(input)) {
    throw new Error("Private position quantity must be a whole number");
  }
  const quantity = BigInt(input);
  if (quantity < 1n || quantity > 1_000n) {
    throw new Error("Private position quantity must be between 1 and 1,000");
  }
  return quantity;
}

const ORDER_STAKE_BUCKETS = [1n, 5n, 10n, 25n, 50n, 100n, 250n, 500n, 1_000n];

export function privacyStakeForOrder(
  value: string,
  decimals: number,
): { orderAmount: string; stakeAmount: string; stakeAtomic: bigint } {
  const parsed = parseWholeOrderAmount(value, decimals);
  const amount = BigInt(parsed.orderAmount);
  const stake = ORDER_STAKE_BUCKETS.find((bucket) => amount <= bucket);
  if (stake === undefined) throw new Error("Private orders support up to 1,000 collateral units");
  return {
    orderAmount: parsed.orderAmount,
    stakeAmount: stake.toString(),
    stakeAtomic: stake * 10n ** BigInt(decimals),
  };
}
