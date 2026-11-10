"use client";

import { getAddress, getNetworkDetails, isAllowed, isConnected, requestAccess } from "@stellar/freighter-api";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { paymentDeployment } from "@/lib/deployment";
import { loadPublicUsdcBalance } from "@/lib/public-usdc";

type PublicWalletStatus = "disconnected" | "connecting" | "loading" | "ready" | "wrong_network" | "error";
interface WalletState {
  status: PublicWalletStatus;
  address: string | null;
  balanceAtomic: bigint | null;
  accountActive: boolean | null;
  hasTrustline: boolean | null;
  error: string | null;
}
interface StellarWalletContextValue extends WalletState {
  connect(): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
}
const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);
const DISCONNECTED_KEY = "moros-pay-public-wallet-disconnected";
const empty: WalletState = { status: "disconnected", address: null, balanceAtomic: null, accountActive: null, hasTrustline: null, error: null };

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(empty);
  const request = useRef<AbortController | null>(null);
  const address = useRef<string | null>(null);
  const lastRefresh = useRef(0);

  const read = useCallback(async (controller: AbortController, account: string) => {
    if (!paymentDeployment.ready) throw new Error(paymentDeployment.reason);
    const network = await getNetworkDetails();
    if (controller.signal.aborted) return;
    if (network.error) throw new Error(network.error.message);
    address.current = account;
    if (network.networkPassphrase !== paymentDeployment.deployment.networkPassphrase) {
      setState({ ...empty, status: "wrong_network", address: account, error: `Switch Freighter to ${paymentDeployment.deployment.environment}, then refresh.` });
      return;
    }
    setState({ ...empty, status: "loading", address: account });
    const balance = await loadPublicUsdcBalance({ horizonUrl: paymentDeployment.deployment.horizonUrl, address: account, issuer: paymentDeployment.deployment.usdcIssuer, signal: controller.signal });
    if (controller.signal.aborted) return;
    lastRefresh.current = Date.now();
    setState({ status: "ready", address: account, ...balance, error: null });
  }, []);

  const run = useCallback(async (choose: () => Promise<string | null>, status: PublicWalletStatus) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (status !== "disconnected") setState((current) => ({ ...current, status, error: null }));
    try {
      const account = await choose();
      if (controller.signal.aborted) return;
      if (account) await read(controller, account);
      else { address.current = null; setState(empty); }
    } catch (cause) {
      if (!controller.signal.aborted) setState({ ...empty, address: address.current, status: "error", error: cause instanceof Error ? cause.message : "Could not connect to Freighter. Try again." });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [read]);

  const connect = useCallback(async () => run(async () => {
    const installed = await isConnected();
    if (!installed.isConnected) throw new Error("Install and unlock the Freighter browser extension, then connect again.");
    const access = await requestAccess();
    if (access.error) throw new Error(access.error.message);
    if (!access.address) throw new Error("Freighter did not return an account. Unlock the extension and try again.");
    try { localStorage.removeItem(DISCONNECTED_KEY); } catch {}
    return access.address;
  }, "connecting"), [run]);

  const disconnect = useCallback(() => {
    request.current?.abort();
    request.current = null;
    address.current = null;
    try { localStorage.setItem(DISCONNECTED_KEY, "1"); } catch {}
    setState(empty);
  }, []);

  const refresh = useCallback(async () => {
    if (!address.current || request.current) return;
    await run(async () => {
      const selected = await getAddress();
      if (selected.error) throw new Error(selected.error.message);
      return selected.address || null;
    }, "loading");
  }, [run]);

  useEffect(() => {
    let disconnected = false;
    try { disconnected = localStorage.getItem(DISCONNECTED_KEY) === "1"; } catch {}
    const controller = new AbortController();
    if (!disconnected && paymentDeployment.ready) {
      request.current = controller;
      void (async () => {
        const allowed = await isAllowed();
        if (controller.signal.aborted || allowed.error || !allowed.isAllowed) return;
        const selected = await getAddress();
        if (controller.signal.aborted || selected.error || !selected.address) return;
        await read(controller, selected.address);
      })().catch((cause) => {
        if (!controller.signal.aborted) setState({ ...empty, status: "error", error: cause instanceof Error ? cause.message : "Could not restore the wallet connection." });
      }).finally(() => { if (request.current === controller) request.current = null; });
    }
    const onFocus = () => { if (Date.now() - lastRefresh.current >= 15_000) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { request.current?.abort(); window.removeEventListener("focus", onFocus); };
  }, [read, refresh]);

  const value = useMemo(() => ({ ...state, connect, disconnect, refresh }), [state, connect, disconnect, refresh]);
  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>;
}

export function useStellarWallet(): StellarWalletContextValue {
  const value = useContext(StellarWalletContext);
  if (!value) throw new Error("Stellar wallet provider is missing");
  return value;
}
