"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { paymentDeployment } from "@/lib/deployment";
import { createRecoveryPhrase, derivePaymentIdentity, type PaymentIdentityView } from "@/lib/payment-identity";
import { decryptRecoveryPhrase, encryptRecoveryPhrase } from "@/lib/wallet-crypto";
import { deleteEncryptedWallet, loadEncryptedWallet, saveEncryptedWallet } from "@/lib/wallet-store";
import { scanPrivatePaymentBalance } from "@/lib/private-balance";

type WalletStatus = "loading" | "empty" | "locked" | "backup" | "unlocked";

interface PaymentWalletContext {
  status: WalletStatus;
  identity: PaymentIdentityView | null;
  recoveryPhrase: string | null;
  error: string | null;
  balance: {
    status: "locked" | "unavailable" | "syncing" | "ready" | "error";
    spendableAtomic: bigint | null;
    pendingAtomic: bigint | null;
    error: string | null;
  };
  create(password: string): Promise<string>;
  activate(phrase: string): Promise<void>;
  restore(phrase: string, password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): void;
  erase(): Promise<void>;
  refreshBalance(): Promise<void>;
  clearError(): void;
}

const WalletContext = createContext<PaymentWalletContext | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The private wallet operation failed.";
}

export function PaymentWalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [identity, setIdentity] = useState<PaymentIdentityView | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<PaymentWalletContext["balance"]>({
    status: "locked",
    spendableAtomic: null,
    pendingAtomic: null,
    error: null,
  });
  const phraseRef = useRef<string | null>(null);
  const balanceRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    loadEncryptedWallet()
      .then((record) => active && setStatus(record ? "locked" : "empty"))
      .catch((cause) => {
        if (active) {
          setError(message(cause));
          setStatus("empty");
        }
      });
    return () => {
      active = false;
      balanceRequestRef.current?.abort();
      phraseRef.current = null;
    };
  }, []);

  const refreshBalance = useCallback(async () => {
    const phrase = phraseRef.current;
    if (!phrase) {
      setBalance({ status: "locked", spendableAtomic: null, pendingAtomic: null, error: null });
      return;
    }
    if (!paymentDeployment.ready) {
      setBalance({
        status: "unavailable",
        spendableAtomic: null,
        pendingAtomic: null,
        error: paymentDeployment.reason,
      });
      return;
    }
    balanceRequestRef.current?.abort();
    const controller = new AbortController();
    balanceRequestRef.current = controller;
    setBalance((current) => ({ ...current, status: "syncing", error: null }));
    try {
      const snapshot = await scanPrivatePaymentBalance({
        phrase,
        deployment: paymentDeployment.deployment,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setBalance({
        status: "ready",
        spendableAtomic: snapshot.spendableAtomic,
        pendingAtomic: 0n,
        error: null,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setBalance({
        status: "error",
        spendableAtomic: null,
        pendingAtomic: null,
        error: message(cause),
      });
    }
  }, []);

  const setUnlocked = useCallback(async (phrase: string) => {
    let nextIdentity: PaymentIdentityView | null = null;
    if (paymentDeployment.ready) {
      nextIdentity = await derivePaymentIdentity(phrase, paymentDeployment.deployment);
    }
    phraseRef.current = phrase;
    setRecoveryPhrase(phrase);
    setIdentity(nextIdentity);
    setStatus("unlocked");
    void refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    const onFocus = () => {
      if (phraseRef.current && document.visibilityState === "visible") {
        void refreshBalance();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshBalance]);

  const create = useCallback(async (password: string) => {
    setError(null);
    try {
      const phrase = await createRecoveryPhrase();
      const record = await encryptRecoveryPhrase(phrase, password);
      await saveEncryptedWallet(record);
      return phrase;
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }, []);

  const activate = useCallback(async (phrase: string) => {
    setError(null);
    try {
      const record = await loadEncryptedWallet();
      if (!record) throw new Error("No private wallet exists in this browser.");
      await saveEncryptedWallet({ ...record, backupVerified: true });
      await setUnlocked(phrase);
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }, [setUnlocked]);

  const restore = useCallback(async (phrase: string, password: string) => {
    setError(null);
    try {
      const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");
      if (paymentDeployment.ready) await derivePaymentIdentity(normalized, paymentDeployment.deployment);
      const record = await encryptRecoveryPhrase(normalized, password, Date.now(), true);
      await saveEncryptedWallet(record);
      await setUnlocked(normalized);
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }, [setUnlocked]);

  const unlock = useCallback(async (password: string) => {
    setError(null);
    try {
      const record = await loadEncryptedWallet();
      if (!record) throw new Error("No private wallet exists in this browser.");
      const phrase = await decryptRecoveryPhrase(record, password);
      if (record.backupVerified) {
        await setUnlocked(phrase);
      } else {
        phraseRef.current = phrase;
        setRecoveryPhrase(phrase);
        setStatus("backup");
      }
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }, [setUnlocked]);

  const lock = useCallback(() => {
    balanceRequestRef.current?.abort();
    phraseRef.current = null;
    setRecoveryPhrase(null);
    setIdentity(null);
    setError(null);
    setBalance({ status: "locked", spendableAtomic: null, pendingAtomic: null, error: null });
    setStatus("locked");
  }, []);

  const erase = useCallback(async () => {
    balanceRequestRef.current?.abort();
    await deleteEncryptedWallet();
    phraseRef.current = null;
    setRecoveryPhrase(null);
    setIdentity(null);
    setError(null);
    setBalance({ status: "unavailable", spendableAtomic: null, pendingAtomic: null, error: null });
    setStatus("empty");
  }, []);

  const value = useMemo<PaymentWalletContext>(() => ({
    status,
    identity,
    recoveryPhrase,
    error,
    balance,
    create,
    activate,
    restore,
    unlock,
    lock,
    erase,
    refreshBalance,
    clearError: () => setError(null),
  }), [status, identity, recoveryPhrase, error, balance, create, activate, restore, unlock, lock, erase, refreshBalance]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function usePaymentWallet(): PaymentWalletContext {
  const value = useContext(WalletContext);
  if (!value) throw new Error("payment wallet provider is missing");
  return value;
}
