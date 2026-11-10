"use client";

import { useCallback, useSyncExternalStore } from "react";

export function useExpired(expiresAt?: number) {
  const subscribe = useCallback((notify: () => void) => {
    if (expiresAt === undefined) return () => {};
    const timer = window.setTimeout(notify, Math.max(0, expiresAt * 1000 - Date.now()));
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", notify);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", notify);
      document.removeEventListener("visibilitychange", notify);
    };
  }, [expiresAt]);
  const snapshot = useCallback(() => expiresAt !== undefined && Date.now() >= expiresAt * 1000, [expiresAt]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
