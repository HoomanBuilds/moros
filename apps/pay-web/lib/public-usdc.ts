import { StrKey } from "@stellar/stellar-sdk";

const USDC_SCALE = 10_000_000n;

function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export interface PublicUsdcBalance {
  accountActive: boolean;
  hasTrustline: boolean;
  balanceAtomic: bigint;
}

interface HorizonBalance {
  asset_type?: unknown;
  asset_code?: unknown;
  asset_issuer?: unknown;
  balance?: unknown;
}

function parseAtomicAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new Error("Horizon returned an invalid USDC balance.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(7, "0"));
}

export async function loadPublicUsdcBalance({
  horizonUrl,
  address,
  issuer,
  fetchImpl = browserFetch,
  signal,
}: {
  horizonUrl: string;
  address: string;
  issuer: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PublicUsdcBalance> {
  if (!StrKey.isValidEd25519PublicKey(address)) throw new Error("The connected Stellar account is invalid.");
  if (!StrKey.isValidEd25519PublicKey(issuer)) throw new Error("The configured USDC issuer is invalid.");
  const response = await fetchImpl(`${horizonUrl.replace(/\/$/, "")}/accounts/${address}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 404) {
    return { accountActive: false, hasTrustline: false, balanceAtomic: 0n };
  }
  if (!response.ok) throw new Error(`Could not read the Stellar account (${response.status}).`);
  const payload = await response.json() as { balances?: unknown };
  if (!Array.isArray(payload.balances)) throw new Error("Horizon returned an invalid account response.");
  const trustline = payload.balances.find((item): item is HorizonBalance => {
    if (!item || typeof item !== "object") return false;
    const balance = item as HorizonBalance;
    return balance.asset_code === "USDC" && balance.asset_issuer === issuer;
  });
  return {
    accountActive: true,
    hasTrustline: Boolean(trustline),
    balanceAtomic: trustline ? parseAtomicAmount(trustline.balance) : 0n,
  };
}

export function formatUsdcAtomic(value: bigint | null): string {
  if (value === null) return "--";
  if (value < 0n) throw new Error("USDC balance cannot be negative.");
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
