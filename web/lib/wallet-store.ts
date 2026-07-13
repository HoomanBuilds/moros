"use client";
import { useSyncExternalStore } from "react";
import { getKit } from "./wallet";

let address = "";
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!hydrated) {
    hydrated = true;
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
  address = connected;
  emit();
  return connected;
}
