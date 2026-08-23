import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager } from "react-native";
import type SignClient from "@walletconnect/sign-client";
import { paymentDeployment } from "@/lib/deployment";
import { productUrls } from "@/lib/product-urls";
import {
  freighterPairingUrl,
  pairingTopicFromUri,
  parseWalletConnectProjectId,
  selectWalletConnectSession,
  signedXdrFromWalletConnect,
  stellarWalletConnectChain,
  STELLAR_SIGN_XDR_METHOD,
  walletConnectAccountFromEvent,
  walletConnectSessionAddress,
  type WalletConnectSession,
} from "@/lib/stellar-walletconnect";

type StellarWalletStatus = "unavailable" | "disconnected" | "initializing" | "connecting" | "ready" | "error";

type StellarWalletContextValue = {
  status: StellarWalletStatus;
  address: string | null;
  walletName: string | null;
  pairingUri: string | null;
  error: string | null;
  connect(): Promise<void>;
  cancelConnection(): Promise<void>;
  disconnect(): Promise<void>;
  openWallet(preferred?: "system" | "freighter"): Promise<void>;
  signTransaction(xdr: string): Promise<string>;
};

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);
const projectId = parseWalletConnectProjectId(Constants.expoConfig?.extra?.walletConnectProjectId);
const chain = paymentDeployment.ready
  ? stellarWalletConnectChain(paymentDeployment.environment, paymentDeployment.network)
  : null;
let clientPromise: Promise<SignClient> | null = null;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return error instanceof Error ? error.message : "The Stellar wallet connection failed.";
}

async function loadClient(): Promise<SignClient> {
  if (!projectId) throw new Error("WalletConnect setup is required in this build.");
  if (!clientPromise) {
    clientPromise = import("@walletconnect/sign-client")
      .then(({ default: Client }) => Client.init({
        projectId,
        name: "moros-pay",
        logger: "error",
        telemetryEnabled: false,
        customStoragePrefix: "moros-pay-stellar",
        metadata: {
          name: "Moros Pay",
          description: "Private Circle USDC payments on Stellar",
          url: productUrls.pay,
          icons: [`${productUrls.pay}/icon.png`],
          redirect: {
            native: "moros://deposit",
            universal: productUrls.pay,
          },
        },
      }))
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

export function StellarWalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StellarWalletStatus>(projectId && chain ? "disconnected" : "unavailable");
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<SignClient | null>(null);
  const sessionRef = useRef<WalletConnectSession | null>(null);
  const connectPendingRef = useRef<Promise<void> | null>(null);
  const connectionGenerationRef = useRef(0);
  const detachListenersRef = useRef<(() => void) | null>(null);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setAddress(null);
    setWalletName(null);
    setPairingUri(null);
    setStatus(projectId && chain ? "disconnected" : "unavailable");
  }, []);

  const applySession = useCallback((session: WalletConnectSession) => {
    if (!chain) throw new Error("This Stellar network is not supported by the connected wallet.");
    const nextAddress = walletConnectSessionAddress(session, chain);
    if (!nextAddress) throw new Error("The wallet did not approve Stellar transaction signing on this network.");
    sessionRef.current = session;
    setAddress(nextAddress);
    setWalletName(session.peer.metadata.name || "Stellar wallet");
    setPairingUri(null);
    setError(null);
    setStatus("ready");
  }, []);

  const attachClient = useCallback((client: SignClient) => {
    if (clientRef.current === client && detachListenersRef.current) return;
    detachListenersRef.current?.();
    clientRef.current = client;
    const handleSessionDelete = ({ topic }: { topic: string }) => {
      if (sessionRef.current?.topic === topic) clearSession();
    };
    const handleSessionExpire = ({ topic }: { topic: string }) => {
      if (sessionRef.current?.topic === topic) clearSession();
    };
    const handleSessionUpdate = ({ topic, params }: { topic: string; params: { namespaces: WalletConnectSession["namespaces"] } }) => {
      if (sessionRef.current?.topic !== topic || !chain) return;
      const current = client.session.get(topic) as unknown as WalletConnectSession;
      const updated = { ...current, namespaces: params.namespaces } as WalletConnectSession;
      try {
        applySession(updated);
      } catch (cause) {
        setError(errorMessage(cause));
        clearSession();
      }
    };
    const handleSessionEvent = ({ topic, params }: { topic: string; params: { chainId?: string; event: { name: string; data: unknown } } }) => {
      if (sessionRef.current?.topic !== topic || params.chainId !== chain || params.event.name !== "accountsChanged") return;
      const nextAddress = walletConnectAccountFromEvent(params.event.data, chain);
      if (nextAddress) {
        setAddress(nextAddress);
        return;
      }
      clearSession();
      void client.disconnect({
        topic,
        reason: { code: 6000, message: "No Stellar account is available" },
      }).catch(() => undefined);
    };
    client.on("session_delete", handleSessionDelete);
    client.on("session_expire", handleSessionExpire);
    client.on("session_update", handleSessionUpdate);
    client.on("session_event", handleSessionEvent);
    detachListenersRef.current = () => {
      client.off("session_delete", handleSessionDelete);
      client.off("session_expire", handleSessionExpire);
      client.off("session_update", handleSessionUpdate);
      client.off("session_event", handleSessionEvent);
      detachListenersRef.current = null;
    };
  }, [applySession, clearSession]);

  const initialize = useCallback(async () => {
    if (!projectId || !chain) return;
    setStatus((current) => current === "disconnected" ? "initializing" : current);
    try {
      const client = await loadClient();
      attachClient(client);
      const session = selectWalletConnectSession(client.session.getAll() as unknown as WalletConnectSession[], chain);
      if (session) applySession(session);
      else setStatus((current) => current === "initializing" ? "disconnected" : current);
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus("error");
    }
  }, [applySession, attachClient]);

  useEffect(() => {
    if (!projectId || !chain) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void initialize();
    });
    return () => task.cancel();
  }, [initialize]);

  useEffect(() => () => {
    connectionGenerationRef.current += 1;
    detachListenersRef.current?.();
  }, []);

  const openWallet = useCallback(async (preferred: "system" | "freighter" = "system") => {
    try {
      if (!pairingUri) throw new Error("Start a wallet connection first.");
      const destination = preferred === "freighter" ? freighterPairingUrl(pairingUri) : pairingUri;
      await Linking.openURL(destination);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [pairingUri]);

  const connect = useCallback(async () => {
    if (!projectId) {
      setStatus("unavailable");
      setError("WalletConnect setup is required in this build.");
      return;
    }
    if (!chain) {
      setStatus("unavailable");
      setError("This payment network is not supported by external Stellar wallets.");
      return;
    }
    if (sessionRef.current) return;
    if (connectPendingRef.current) return connectPendingRef.current;
    const generation = ++connectionGenerationRef.current;
    const pending = (async () => {
      setStatus("connecting");
      setError(null);
      try {
        const client = await loadClient();
        if (connectionGenerationRef.current !== generation) return;
        attachClient(client);
        const existing = selectWalletConnectSession(client.session.getAll() as unknown as WalletConnectSession[], chain);
        if (existing) {
          applySession(existing);
          return;
        }
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            stellar: {
              methods: [STELLAR_SIGN_XDR_METHOD],
              chains: [chain],
              events: ["accountsChanged"],
            },
          },
        });
        if (!uri) throw new Error("The wallet connection did not provide a pairing code.");
        setPairingUri(uri);
        try {
          await Linking.openURL(uri);
        } catch {
          try {
            await Linking.openURL(freighterPairingUrl(uri));
          } catch {
            setError("Open a Stellar wallet and scan or paste the pairing code below.");
          }
        }
        const approved = await approval() as unknown as WalletConnectSession;
        if (connectionGenerationRef.current !== generation) {
          await client.disconnect({
            topic: approved.topic,
            reason: { code: 6000, message: "Connection cancelled" },
          }).catch(() => undefined);
          return;
        }
        applySession(approved);
      } catch (cause) {
        if (!sessionRef.current && connectionGenerationRef.current === generation) {
          setPairingUri(null);
          setStatus("error");
          setError(errorMessage(cause));
        }
      } finally {
        if (connectionGenerationRef.current === generation) connectPendingRef.current = null;
      }
    })();
    connectPendingRef.current = pending;
    return pending;
  }, [applySession, attachClient]);

  const cancelConnection = useCallback(async () => {
    connectionGenerationRef.current += 1;
    connectPendingRef.current = null;
    const uri = pairingUri;
    setPairingUri(null);
    setError(null);
    setStatus(projectId && chain ? "disconnected" : "unavailable");
    const topic = uri ? pairingTopicFromUri(uri) : null;
    if (topic && clientRef.current) {
      try {
        await clientRef.current.core.pairing.disconnect({ topic });
      } catch {
        return;
      }
    }
  }, [pairingUri]);

  const disconnect = useCallback(async () => {
    connectionGenerationRef.current += 1;
    connectPendingRef.current = null;
    const current = sessionRef.current;
    clearSession();
    if (!current || !clientRef.current) return;
    try {
      await clientRef.current.disconnect({
        topic: current.topic,
        reason: { code: 6000, message: "User disconnected" },
      });
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus("error");
    }
  }, [clearSession]);

  const signTransaction = useCallback(async (xdr: string) => {
    const client = clientRef.current;
    const session = sessionRef.current;
    if (!client || !session || !chain || !address) throw new Error("Connect a Stellar wallet before signing.");
    if (typeof xdr !== "string" || xdr.length < 16 || xdr.length > 1_000_000) {
      throw new Error("The transaction to sign is invalid.");
    }
    const result = await client.request<unknown>({
      topic: session.topic,
      chainId: chain,
      request: {
        method: STELLAR_SIGN_XDR_METHOD,
        params: { xdr },
      },
    });
    return signedXdrFromWalletConnect(result);
  }, [address]);

  const value = useMemo<StellarWalletContextValue>(() => ({
    status,
    address,
    walletName,
    pairingUri,
    error,
    connect,
    cancelConnection,
    disconnect,
    openWallet,
    signTransaction,
  }), [status, address, walletName, pairingUri, error, connect, cancelConnection, disconnect, openWallet, signTransaction]);

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>;
}

export function useStellarWallet(): StellarWalletContextValue {
  const value = useContext(StellarWalletContext);
  if (!value) throw new Error("Stellar wallet provider is missing");
  return value;
}
