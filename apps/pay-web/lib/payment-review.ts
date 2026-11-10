export const MAX_PAYMENT_AMOUNT = (1n << 64n) - 1n;

export class PaymentFailedError extends Error {}

export function paymentTransactionHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error("Payment confirmation did not include a valid transaction ID.");
  return value.toLowerCase();
}

export function confirmedDepositHash(sent: { getTransactionResponse?: { status: string }; sendTransactionResponse?: { hash?: string }; hash?: string }): string {
  if (sent.getTransactionResponse?.status === "FAILED") throw new PaymentFailedError("The deposit failed on Stellar. Your deposit was not completed.");
  if (sent.getTransactionResponse?.status !== "SUCCESS") throw new Error("Deposit confirmation is unavailable. Check your wallet activity before trying again.");
  return paymentTransactionHash(sent.sendTransactionResponse?.hash || sent.hash);
}

export function parsePaymentAmount(value: string): bigint {
  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d{0,7})?|\.\d{1,7})$/.test(trimmed) || trimmed.length > 28) {
    throw new Error("Enter a USDC amount with up to 7 decimal places.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const amount = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
  if (amount <= 0n || amount > MAX_PAYMENT_AMOUNT) throw new Error("Enter a valid positive USDC amount.");
  return amount;
}

export function checkPaymentBalance(amount: bigint, balance: bigint | null, fee = 0n): void {
  if (amount <= 0n || fee < 0n || amount + fee > MAX_PAYMENT_AMOUNT) throw new Error("The payment total is invalid.");
  if (balance === null) throw new Error("Refresh your balance before reviewing this payment.");
  if (amount + fee > balance) throw new Error("Not enough available USDC for this amount and its fees.");
}

export function checkPaymentExpiry(expiry: number, now = Math.floor(Date.now() / 1000)): void {
  if (!Number.isSafeInteger(expiry) || expiry <= now) throw new Error("This request or fee quote has expired. Review the payment again.");
}

export class FlowRevision {
  private revision = 0;
  private submitting = false;

  next(): number { return ++this.revision; }
  current(revision: number): boolean { return revision === this.revision; }
  begin(): boolean {
    if (this.submitting) return false;
    this.submitting = true;
    return true;
  }
  finish(): void { this.submitting = false; }
}
