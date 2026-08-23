"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode(mode: ThemeMode): void;
  toggle(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "moros-pay-theme";

function preferredTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [system, setSystem] = useState<"light" | "dark">(() => typeof window === "undefined" ? "dark" : preferredTheme());

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const resolved = mode === "system" ? system : mode;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  function setMode(next: ThemeMode) {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    resolved,
    setMode,
    toggle: () => setMode(resolved === "dark" ? "light" : "dark"),
  }), [mode, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("theme provider is missing");
  return value;
}
