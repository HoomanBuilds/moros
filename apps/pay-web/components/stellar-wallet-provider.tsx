"use client";

import { getAddress, getNetworkDetails, isAllowed, requestAccess } from "@stellar/freighter-api";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { paymentDeployment } from "@/lib/deployment";
import { loadPublicUsdcBalance } from "@/lib/public-usdc";

type PublicWalletStatus = "disconnected" | "connecting" | "loading" | "ready" | "wrong_network" | "error";

interface StellarWalletContextValue {
  status: PublicWalletStatus;
  address: string | null;
  balanceAtomic: bigint | null;
  accountActive: boolean | null;
  hasTrustline: boolean | null;
  error: string | null;
  connect(): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);
const DISCONNECTED_KEY = "moros-pay-public-wallet-disconnected";

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return error instanceof Error ? error.message : "The Stellar wallet connection failed.";
}

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PublicWalletStatus>("disconnected");
  const [address, setAddress] = useState<string | null>(null);
  const [balanceAtomic, setBalanceAtomic] = useState<bigint | null>(null);
  const [accountActive, setAccountActive] = useState<boolean | null>(null);
  const [hasTrustline, setHasTrustline] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addressRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const clearBalance = useCallback(() => {
    setBalanceAtomic(null);
    setAccountActive(null);
    setHasTrustline(null);
  }, []);

  const readWallet = useCallback(async (nextAddress: string) => {
    if (!paymentDeployment.ready) {
      setStatus("error");
      setError(paymentDeployment.reason);
      clearBalance();
      return;
    }
    const network = await getNetworkDetails();
    if (network.error) throw network.error;
    if (network.networkPassphrase !== paymentDeployment.deployment.networkPassphrase) {
      setStatus("wrong_network");
      setError(`Switch Freighter to ${paymentDeployment.deployment.environment}.`);
      clearBalance();
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setError(null);
    const balance = await loadPublicUsdcBalance({
      horizonUrl: paymentDeployment.deployment.horizonUrl,
      address: nextAddress,
      issuer: paymentDeployment.deployment.usdcIssuer,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    setBalanceAtomic(balance.balanceAtomic);
    setAccountActive(balance.accountActive);
    setHasTrustline(balance.hasTrustline);
    setStatus("ready");
  }, [clearBalance]);

  const applyAddress = useCallback(async (nextAddress: string) => {
    addressRef.current = nextAddress;
    setAddress(nextAddress);
    await readWallet(nextAddress);
  }, [readWallet]);

  const connect = useCallback(async () => {
    if (!paymentDeployment.ready) {
      setStatus("error");
      setError(paymentDeployment.reason);
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const access = await requestAccess();
      if (access.error) throw access.error;
      if (!access.address) throw new Error("Freighter did not return an account.");
      localStorage.removeItem(DISCONNECTED_KEY);
      await applyAddress(access.address);
    } catch (cause) {
      setStatus("error");
      setError(errorMessage(cause));
      clearBalance();
    }
  }, [applyAddress, clearBalance]);

  const disconnect = useCallback(() => {
    requestRef.current?.abort();
    localStorage.setItem(DISCONNECTED_KEY, "1");
    addressRef.current = null;
    setAddress(null);
    clearBalance();
    setError(null);
    setStatus("disconnected");
  }, [clearBalance]);

  const refresh = useCallback(async () => {
    const current = addressRef.current;
    if (!current) return;
    try {
      const selected = await getAddress();
      if (selected.error) throw selected.error;
      await applyAddress(selected.address || current);
    } catch (cause) {
      setStatus("error");
      setError(errorMessage(cause));
      clearBalance();
    }
  }, [applyAddress, clearBalance]);

  useEffect(() => {
    let active = true;
    async function restoreConnection() {
      if (!paymentDeployment.ready || localStorage.getItem(DISCONNECTED_KEY) === "1") return;
      try {
        const permission = await isAllowed();
        if (!active || permission.error || !permission.isAllowed) return;
        const selected = await getAddress();
        if (!active || selected.error || !selected.address) return;
        await applyAddress(selected.address);
      } catch {
        return;
      }
    }
    void restoreConnection();
    const onFocus = () => {
      if (addressRef.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      requestRef.current?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [applyAddress, refresh]);

  const value = useMemo<StellarWalletContextValue>(() => ({
    status,
    address,
    balanceAtomic,
    accountActive,
    hasTrustline,
    error,
    connect,
    disconnect,
    refresh,
  }), [status, address, balanceAtomic, accountActive, hasTrustline, error, connect, disconnect, refresh]);

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>;
}

export function useStellarWallet(): StellarWalletContextValue {
  const value = useContext(StellarWalletContext);
  if (!value) throw new Error("Stellar wallet provider is missing");
  return value;
}
