import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { paymentDeployment } from "@/lib/deployment";
import { isValidStellarAccount } from "@/lib/stellar-account";

const PUBLIC_ACCOUNT_KEY = "moros_pay_public_stellar_account";
const USDC_SCALE = 10_000_000n;

type PublicBalanceStatus = "disconnected" | "loading" | "ready" | "error";

interface BalancesContextValue {
  privateBalance: {
    status: "locked" | "unavailable" | "syncing" | "ready" | "error";
    spendableAtomic: bigint | null;
    pendingAtomic: bigint | null;
  };
  publicBalance: {
    status: PublicBalanceStatus;
    account: string | null;
    balanceAtomic: bigint | null;
    accountActive: boolean | null;
    hasTrustline: boolean | null;
    error: string | null;
  };
  pairPublicAccount(account: string): Promise<void>;
  clearPublicAccount(): Promise<void>;
  refreshPublicBalance(): Promise<void>;
}

const BalancesContext = createContext<BalancesContextValue | null>(null);

function parseAtomic(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("Stellar returned an invalid USDC balance.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(7, "0"));
}

export function formatUsdcAtomic(value: bigint | null): string {
  if (value === null) return "--";
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function BalancesProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState<PublicBalanceStatus>("disconnected");
  const [balanceAtomic, setBalanceAtomic] = useState<bigint | null>(null);
  const [accountActive, setAccountActive] = useState<boolean | null>(null);
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accountRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (nextAccount?: string) => {
    const current = nextAccount ?? accountRef.current;
    if (!current) return;
    if (!paymentDeployment.ready) {
      setStatus("error");
      setError(paymentDeployment.reason);
      return;
    }
    const deployment = paymentDeployment;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(`${deployment.horizonUrl}/accounts/${current}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 404) {
        setBalanceAtomic(0n);
        setAccountActive(false);
        setHasTrustline(false);
        setStatus("ready");
        return;
      }
      if (!response.ok) throw new Error(`Could not read the Stellar account (${response.status}).`);
      const payload = await response.json() as { balances?: unknown };
      if (!Array.isArray(payload.balances)) throw new Error("Stellar returned an invalid account response.");
      const trustline = payload.balances.find((item) => item && typeof item === "object" && "asset_code" in item && "asset_issuer" in item && item.asset_code === "USDC" && item.asset_issuer === deployment.usdcIssuer) as { balance?: unknown } | undefined;
      setBalanceAtomic(trustline ? parseAtomic(trustline.balance) : 0n);
      setAccountActive(true);
      setHasTrustline(Boolean(trustline));
      setStatus("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setBalanceAtomic(null);
      setAccountActive(null);
      setHasTrustline(null);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not refresh the public USDC balance.");
    }
  }, []);

  const pairPublicAccount = useCallback(async (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!isValidStellarAccount(normalized)) throw new Error("Enter a valid Stellar G account.");
    await AsyncStorage.setItem(PUBLIC_ACCOUNT_KEY, normalized);
    accountRef.current = normalized;
    setAccount(normalized);
    await refresh(normalized);
  }, [refresh]);

  const clearPublicAccount = useCallback(async () => {
    requestRef.current?.abort();
    await AsyncStorage.removeItem(PUBLIC_ACCOUNT_KEY);
    accountRef.current = null;
    setAccount(null);
    setBalanceAtomic(null);
    setAccountActive(null);
    setHasTrustline(null);
    setError(null);
    setStatus("disconnected");
  }, []);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PUBLIC_ACCOUNT_KEY).then((stored) => {
      if (!active || !stored || !isValidStellarAccount(stored)) return;
      accountRef.current = stored;
      setAccount(stored);
      void refresh(stored);
    });
    return () => {
      active = false;
      requestRef.current?.abort();
    };
  }, [refresh]);

  const value = useMemo<BalancesContextValue>(() => ({
    privateBalance: {
      status: paymentDeployment.ready ? "unavailable" : "locked",
      spendableAtomic: null,
      pendingAtomic: null,
    },
    publicBalance: { status, account, balanceAtomic, accountActive, hasTrustline, error },
    pairPublicAccount,
    clearPublicAccount,
    refreshPublicBalance: () => refresh(),
  }), [status, account, balanceAtomic, accountActive, hasTrustline, error, pairPublicAccount, clearPublicAccount, refresh]);

  return <BalancesContext.Provider value={value}>{children}</BalancesContext.Provider>;
}

export function useBalances(): BalancesContextValue {
  const value = useContext(BalancesContext);
  if (!value) throw new Error("Balances provider is missing");
  return value;
}
