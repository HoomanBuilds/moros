"use client";
import { useSyncExternalStore } from "react";
import { getKit } from "./wallet";

const OFF_KEY = "moros.wallet.off";
const LEGACY_OFF_KEY = "umbra.wallet.off";
let address = "";
let hydrated = false;
const listeners = new Set<() => void>();

function isOff(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const value = localStorage.getItem(OFF_KEY) ?? localStorage.getItem(LEGACY_OFF_KEY);
    if (value === "1") localStorage.setItem(OFF_KEY, "1");
    return value === "1";
  } catch {
    return false;
  }
}

function setOff(v: boolean) {
  try {
    if (typeof localStorage === "undefined") return;
    if (v) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
    localStorage.removeItem(LEGACY_OFF_KEY);
  } catch {
    return;
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!hydrated) {
    hydrated = true;
    if (!isOff()) {
      getKit()
        .getAddress()
        .then((r) => {
          if (r.address !== address) {
            address = r.address;
            emit();
          }
        })
        .catch(() => {});
    }
  }
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string {
  return address;
}

function getServerSnapshot(): string {
  return "";
}

export function useWalletAddress(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function connectWallet(): Promise<string> {
  const { address: connected } = await getKit().authModal();
  setOff(false);
  address = connected;
  emit();
  return connected;
}

export async function disconnectWallet(): Promise<void> {
  try {
    await getKit().disconnect();
  } catch {
    // kit may not expose disconnect; clearing local state is enough
  }
  setOff(true);
  address = "";
  emit();
}
