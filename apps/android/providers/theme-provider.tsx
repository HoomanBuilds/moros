import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { darkTheme, lightTheme, type MorosTheme, type ThemeMode } from "@/constants/theme";

const STORAGE_KEY = "moros_pay_theme";

type ThemeContextValue = {
  mode: ThemeMode;
  theme: MorosTheme;
  setMode(mode: ThemeMode): void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function MorosThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setStoredMode] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "system" || stored === "light" || stored === "dark") setStoredMode(stored);
    });
  }, []);

  const dark = mode === "dark" || (mode === "system" && system === "dark");
  const theme = dark ? darkTheme : lightTheme;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background);
  }, [theme.background]);

  const setMode = useCallback((next: ThemeMode) => {
    setStoredMode(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ mode, theme, setMode }), [mode, theme, setMode]);

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={dark ? "light" : "dark"} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useMorosTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("Moros theme provider is missing");
  return value;
}
