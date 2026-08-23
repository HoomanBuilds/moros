export const USDC_SCALE = 10_000_000n;
const MAX_PAYMENT_AMOUNT = (1n << 120n) - 1n;

export function parseUsdcAtomic(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(normalized)) {
    throw new Error("Enter a valid USDC amount with up to 7 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(7, "0"));
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  if (amount > MAX_PAYMENT_AMOUNT) throw new Error("This USDC amount is too large.");
  return amount;
}

export function formatUsdcAtomic(value: bigint | null): string {
  if (value === null) return "--";
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
