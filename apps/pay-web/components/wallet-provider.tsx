"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { paymentDeployment } from "@/lib/deployment";
import { createRecoveryPhrase, derivePaymentIdentity, type PaymentIdentityView } from "@/lib/payment-identity";
import { decryptRecoveryPhrase, encryptRecoveryPhrase } from "@/lib/wallet-crypto";
import { deleteEncryptedWallet, loadEncryptedWallet, saveEncryptedWallet } from "@/lib/wallet-store";
import { createPrivateBalanceSession, type PrivateBalanceSession } from "@/lib/private-balance";
import {
  loadPrivateProfile,
  updatePrivateProfile,
  withContact,
  withPaymentActivity,
  withPaymentRequest,
  withPaymentRequestStatus,
  withoutContact,
  withRecentRecipient,
  type PrivateProfile,
  type PrivatePaymentRequest,
  type PrivatePaymentRequestStatus,
  type PrivateRecipient,
} from "@/lib/private-profile";
import {
  createPrivateProfileSyncSession,
  type PrivateProfileSyncSession,
} from "@/lib/private-profile-sync";
import {
  depositPrivateUsdc,
  transferPrivateUsdc,
  withdrawPrivateUsdc,
  type PaymentActionProgress,
} from "@/lib/payment-actions";

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
  profile: {
    status: "locked" | "loading" | "ready" | "error";
    value: PrivateProfile | null;
    error: string | null;
  };
  recoverySync: {
    status: "locked" | "connecting" | "syncing" | "synced" | "error";
    error: string | null;
  };
  create(password: string): Promise<string>;
  activate(phrase: string): Promise<void>;
  restore(phrase: string, password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): void;
  erase(): Promise<void>;
  refreshBalance(): Promise<void>;
  deposit(source: string, amountAtomic: bigint, progress?: (value: PaymentActionProgress) => void): Promise<string>;
  transfer(input: {
    recipientCode: string;
    recipientFingerprint: string;
    amountAtomic: bigint;
    memo: string;
    payloadHash?: bigint;
  }, progress?: (value: PaymentActionProgress) => void): Promise<string>;
  withdraw(destination: string, amountAtomic: bigint, progress?: (value: PaymentActionProgress) => void): Promise<string>;
  rotateReceiveIdentity(): Promise<void>;
  reserveRequestIdentity(): Promise<number>;
  saveContact(recipient: PrivateRecipient): Promise<void>;
  removeContact(paymentCode: string): Promise<void>;
  rememberRecipient(recipient: PrivateRecipient): Promise<void>;
  savePaymentRequest(request: PrivatePaymentRequest): Promise<void>;
  updatePaymentRequestStatus(requestId: string, status: PrivatePaymentRequestStatus): Promise<void>;
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
  const [profile, setProfile] = useState<PaymentWalletContext["profile"]>({
    status: "locked",
    value: null,
    error: null,
  });
  const [recoverySync, setRecoverySync] = useState<PaymentWalletContext["recoverySync"]>({
    status: "locked",
    error: null,
  });
  const phraseRef = useRef<string | null>(null);
  const profileValueRef = useRef<PrivateProfile | null>(null);
  const balanceRequestRef = useRef<AbortController | null>(null);
  const balanceSessionRef = useRef<PrivateBalanceSession | null>(null);
  const profileSyncSessionRef = useRef<PrivateProfileSyncSession | null>(null);
  const profileSyncControllersRef = useRef(new Set<AbortController>());
  const balancePendingRef = useRef<Promise<void> | null>(null);
  const lastBalanceRefreshRef = useRef(0);
  const refreshBalanceRef = useRef<(() => Promise<void>) | null>(null);
  const operationRef = useRef(false);

  useEffect(() => {
    let active = true;
    const syncControllers = profileSyncControllersRef.current;
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
      balanceSessionRef.current?.dispose();
      balanceSessionRef.current = null;
      for (const controller of syncControllers) controller.abort();
      syncControllers.clear();
      profileSyncSessionRef.current?.dispose();
      profileSyncSessionRef.current = null;
      phraseRef.current = null;
    };
  }, []);

  const synchronizeProfile = useCallback(async (
    session: PrivateProfileSyncSession,
    value: PrivateProfile,
  ) => {
    const controller = new AbortController();
    profileSyncControllersRef.current.add(controller);
    setRecoverySync({ status: "syncing", error: null });
    try {
      const result = await session.sync(value, controller.signal);
      if (controller.signal.aborted || profileSyncSessionRef.current !== session || !phraseRef.current) return;
      profileValueRef.current = result.profile;
      setProfile({ status: "ready", value: result.profile, error: null });
      await balanceSessionRef.current?.expand(result.profile.nextChildIndex - 1);
      if (!paymentDeployment.ready) throw new Error("Payment deployment is unavailable.");
      setIdentity(await derivePaymentIdentity(
        phraseRef.current,
        paymentDeployment.deployment,
        BigInt(result.profile.activeReceiveIndex),
      ));
      await refreshBalanceRef.current?.();
      setRecoverySync({ status: "synced", error: null });
    } catch (cause) {
      if (!controller.signal.aborted && profileSyncSessionRef.current === session) {
        setRecoverySync({ status: "error", error: message(cause) });
      }
    } finally {
      profileSyncControllersRef.current.delete(controller);
    }
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
    if (!balanceSessionRef.current) return;
    if (balancePendingRef.current) return balancePendingRef.current;
    const controller = new AbortController();
    balanceRequestRef.current = controller;
    setBalance((current) => ({ ...current, status: "syncing", error: null }));
    const pending = (async () => {
      try {
        const snapshot = await balanceSessionRef.current?.refresh(controller.signal);
        if (controller.signal.aborted || !snapshot) return;
        lastBalanceRefreshRef.current = Date.now();
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
    })();
    balancePendingRef.current = pending;
    try {
      await pending;
    } finally {
      if (balancePendingRef.current === pending) balancePendingRef.current = null;
    }
  }, []);

  useEffect(() => {
    refreshBalanceRef.current = refreshBalance;
    return () => {
      refreshBalanceRef.current = null;
    };
  }, [refreshBalance]);

  const setUnlocked = useCallback(async (phrase: string) => {
    let nextIdentity: PaymentIdentityView | null = null;
    let nextProfile: PrivateProfile | null = null;
    let nextSession: PrivateBalanceSession | null = null;
    setProfile({ status: "loading", value: null, error: null });
    if (paymentDeployment.ready) {
      const loaded = await loadPrivateProfile(phrase, paymentDeployment.deployment);
      nextProfile = loaded.profile;
      nextIdentity = await derivePaymentIdentity(
        phrase,
        paymentDeployment.deployment,
        BigInt(nextProfile.activeReceiveIndex),
      );
      nextSession = await createPrivateBalanceSession({
        phrase,
        deployment: paymentDeployment.deployment,
        maximumChildIndex: nextProfile.nextChildIndex - 1,
      });
    }
    balanceSessionRef.current?.dispose();
    balanceSessionRef.current = nextSession;
    phraseRef.current = phrase;
    profileValueRef.current = nextProfile;
    setRecoveryPhrase(phrase);
    setIdentity(nextIdentity);
    setProfile(nextProfile
      ? { status: "ready", value: nextProfile, error: null }
      : {
          status: "error",
          value: null,
          error: paymentDeployment.ready ? "The private profile is unavailable." : paymentDeployment.reason,
        });
    setStatus("unlocked");
    void refreshBalance();
    for (const controller of profileSyncControllersRef.current) controller.abort();
    profileSyncControllersRef.current.clear();
    profileSyncSessionRef.current?.dispose();
    profileSyncSessionRef.current = null;
    setRecoverySync({ status: "connecting", error: null });
    if (paymentDeployment.ready && nextProfile) {
      void createPrivateProfileSyncSession({ phrase, deployment: paymentDeployment.deployment })
        .then((session) => {
          if (phraseRef.current !== phrase) {
            session.dispose();
            return;
          }
          profileSyncSessionRef.current = session;
          return synchronizeProfile(session, profileValueRef.current ?? nextProfile);
        })
        .catch((cause) => {
          if (phraseRef.current === phrase) setRecoverySync({ status: "error", error: message(cause) });
        });
    } else {
      setRecoverySync({
        status: "error",
        error: paymentDeployment.ready ? "The private profile is unavailable." : paymentDeployment.reason,
      });
    }
  }, [refreshBalance, synchronizeProfile]);

  useEffect(() => {
    const onFocus = () => {
      if (
        phraseRef.current &&
        document.visibilityState === "visible" &&
        Date.now() - lastBalanceRefreshRef.current >= 15_000
      ) {
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
    balanceSessionRef.current?.dispose();
    balanceSessionRef.current = null;
    balancePendingRef.current = null;
    phraseRef.current = null;
    profileValueRef.current = null;
    for (const controller of profileSyncControllersRef.current) controller.abort();
    profileSyncControllersRef.current.clear();
    profileSyncSessionRef.current?.dispose();
    profileSyncSessionRef.current = null;
    setRecoveryPhrase(null);
    setIdentity(null);
    setError(null);
    setBalance({ status: "locked", spendableAtomic: null, pendingAtomic: null, error: null });
    setProfile({ status: "locked", value: null, error: null });
    setRecoverySync({ status: "locked", error: null });
    setStatus("locked");
  }, []);

  const erase = useCallback(async () => {
    balanceRequestRef.current?.abort();
    balanceSessionRef.current?.dispose();
    balanceSessionRef.current = null;
    balancePendingRef.current = null;
    for (const controller of profileSyncControllersRef.current) controller.abort();
    profileSyncControllersRef.current.clear();
    profileSyncSessionRef.current?.dispose();
    profileSyncSessionRef.current = null;
    await deleteEncryptedWallet();
    phraseRef.current = null;
    profileValueRef.current = null;
    setRecoveryPhrase(null);
    setIdentity(null);
    setError(null);
    setBalance({ status: "unavailable", spendableAtomic: null, pendingAtomic: null, error: null });
    setProfile({ status: "locked", value: null, error: null });
    setRecoverySync({ status: "locked", error: null });
    setStatus("empty");
  }, []);

  const changeProfile = useCallback(async (
    update: (current: PrivateProfile) => PrivateProfile,
  ): Promise<PrivateProfile> => {
    const phrase = phraseRef.current;
    if (!phrase || !paymentDeployment.ready) throw new Error("Unlock the private wallet first.");
    try {
      const next = await updatePrivateProfile(phrase, paymentDeployment.deployment, update);
      profileValueRef.current = next;
      setProfile({ status: "ready", value: next, error: null });
      const syncSession = profileSyncSessionRef.current;
      if (syncSession) void synchronizeProfile(syncSession, next);
      return next;
    } catch (cause) {
      setProfile((current) => ({ ...current, status: "error", error: message(cause) }));
      throw cause;
    }
  }, [synchronizeProfile]);

  const rotateReceiveIdentity = useCallback(async () => {
    const phrase = phraseRef.current;
    if (!phrase || !paymentDeployment.ready) throw new Error("Unlock the private wallet first.");
    let childIndex = -1;
    const next = await changeProfile((current) => {
      childIndex = current.nextChildIndex;
      if (childIndex > 999) throw new Error("The private receive identity limit has been reached.");
      return {
        ...current,
        activeReceiveIndex: childIndex,
        nextChildIndex: childIndex + 1,
      };
    });
    await balanceSessionRef.current?.expand(next.activeReceiveIndex);
    setIdentity(await derivePaymentIdentity(phrase, paymentDeployment.deployment, BigInt(next.activeReceiveIndex)));
  }, [changeProfile]);

  const reserveRequestIdentity = useCallback(async (): Promise<number> => {
    let childIndex = -1;
    await changeProfile((current) => {
      childIndex = current.nextChildIndex;
      if (childIndex > 999) throw new Error("The private receive identity limit has been reached.");
      return { ...current, nextChildIndex: childIndex + 1 };
    });
    await balanceSessionRef.current?.expand(childIndex);
    return childIndex;
  }, [changeProfile]);

  const saveContact = useCallback(async (recipient: PrivateRecipient) => {
    await changeProfile((current) => withContact(current, recipient));
  }, [changeProfile]);

  const removeContact = useCallback(async (paymentCode: string) => {
    await changeProfile((current) => withoutContact(current, paymentCode));
  }, [changeProfile]);

  const rememberRecipient = useCallback(async (recipient: PrivateRecipient) => {
    await changeProfile((current) => withRecentRecipient(current, recipient));
  }, [changeProfile]);

  const savePaymentRequest = useCallback(async (request: PrivatePaymentRequest) => {
    await changeProfile((current) => withPaymentRequest(current, request));
  }, [changeProfile]);

  const updatePaymentRequestStatus = useCallback(async (
    requestId: string,
    requestStatus: PrivatePaymentRequestStatus,
  ) => {
    await changeProfile((current) => withPaymentRequestStatus(current, requestId, requestStatus));
  }, [changeProfile]);

  const runOperation = useCallback(async (operation: () => Promise<string>) => {
    if (operationRef.current) throw new Error("Another private payment is already in progress.");
    operationRef.current = true;
    try {
      const hash = await operation();
      await refreshBalance();
      window.setTimeout(() => void refreshBalance(), 5_000);
      return hash;
    } finally {
      operationRef.current = false;
    }
  }, [refreshBalance]);

  const deposit = useCallback(async (
    source: string,
    amountAtomic: bigint,
    progress?: (value: PaymentActionProgress) => void,
  ) => {
    if (!paymentDeployment.ready || !identity) throw new Error("Unlock the private wallet first.");
    const deployment = paymentDeployment.deployment;
    const hash = await runOperation(() => depositPrivateUsdc({
      deployment,
      source,
      recipientCode: identity.paymentCode,
      amountAtomic,
      progress,
    }));
    try {
      await changeProfile((current) => withPaymentActivity(current, {
        transactionHash: hash,
        kind: "deposit",
        amountAtomic: amountAtomic.toString(),
        createdAt: Date.now(),
      }));
    } catch {}
    return hash;
  }, [changeProfile, identity, runOperation]);

  const transfer = useCallback(async (
    input: { recipientCode: string; recipientFingerprint: string; amountAtomic: bigint; memo: string; payloadHash?: bigint },
    progress?: (value: PaymentActionProgress) => void,
  ) => {
    if (!paymentDeployment.ready || !identity || !balanceSessionRef.current) {
      throw new Error("Unlock the private wallet first.");
    }
    const deployment = paymentDeployment.deployment;
    const session = balanceSessionRef.current;
    const hash = await runOperation(() => transferPrivateUsdc({
      deployment,
      senderCode: identity.paymentCode,
      recipientCode: input.recipientCode,
      amountAtomic: input.amountAtomic,
      memo: input.memo,
      payloadHash: input.payloadHash,
      prepareSpend: (requiredAtomic, signal) => session.prepareSpend(requiredAtomic, signal),
      progress,
    }));
    try {
      await changeProfile((current) => withPaymentActivity(current, {
        transactionHash: hash,
        kind: "send",
        amountAtomic: input.amountAtomic.toString(),
        recipientFingerprint: input.recipientFingerprint,
        createdAt: Date.now(),
      }));
    } catch {}
    return hash;
  }, [changeProfile, identity, runOperation]);

  const withdraw = useCallback(async (
    destination: string,
    amountAtomic: bigint,
    progress?: (value: PaymentActionProgress) => void,
  ) => {
    if (!paymentDeployment.ready || !identity || !balanceSessionRef.current) {
      throw new Error("Unlock the private wallet first.");
    }
    const deployment = paymentDeployment.deployment;
    const session = balanceSessionRef.current;
    const hash = await runOperation(() => withdrawPrivateUsdc({
      deployment,
      senderCode: identity.paymentCode,
      destination,
      amountAtomic,
      prepareSpend: (requiredAtomic, signal) => session.prepareSpend(requiredAtomic, signal),
      progress,
    }));
    try {
      await changeProfile((current) => withPaymentActivity(current, {
        transactionHash: hash,
        kind: "withdraw",
        amountAtomic: amountAtomic.toString(),
        publicAccount: destination,
        createdAt: Date.now(),
      }));
    } catch {}
    return hash;
  }, [changeProfile, identity, runOperation]);

  const value = useMemo<PaymentWalletContext>(() => ({
    status,
    identity,
    recoveryPhrase,
    error,
    balance,
    profile,
    recoverySync,
    create,
    activate,
    restore,
    unlock,
    lock,
    erase,
    refreshBalance,
    deposit,
    transfer,
    withdraw,
    rotateReceiveIdentity,
    reserveRequestIdentity,
    saveContact,
    removeContact,
    rememberRecipient,
    savePaymentRequest,
    updatePaymentRequestStatus,
    clearError: () => setError(null),
  }), [status, identity, recoveryPhrase, error, balance, profile, recoverySync, create, activate, restore, unlock, lock, erase, refreshBalance, deposit, transfer, withdraw, rotateReceiveIdentity, reserveRequestIdentity, saveContact, removeContact, rememberRecipient, savePaymentRequest, updatePaymentRequestStatus]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function usePaymentWallet(): PaymentWalletContext {
  const value = useContext(WalletContext);
  if (!value) throw new Error("payment wallet provider is missing");
  return value;
}
