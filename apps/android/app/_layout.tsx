import "@walletconnect/react-native-compat";

import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  useFonts as useInstrumentSans,
} from "@expo-google-fonts/instrument-sans";
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
  useFonts as useInstrumentSerif,
} from "@expo-google-fonts/instrument-serif";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MorosThemeProvider } from "@/providers/theme-provider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { BalancesProvider } from "@/providers/balances-provider";
import { StellarWalletProvider } from "@/providers/stellar-wallet-provider";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [sansLoaded] = useInstrumentSans({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });
  const [serifLoaded] = useInstrumentSerif({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });
  const loaded = sansLoaded && serifLoaded;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MorosThemeProvider>
          <StellarWalletProvider>
            <BalancesProvider><Stack screenOptions={{ headerShown: false, animation: reducedMotion ? "none" : "fade", animationDuration: reducedMotion ? 0 : 220 }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="payment" options={{ presentation: "modal", animation: reducedMotion ? "none" : "slide_from_bottom" }} />
              <Stack.Screen name="request" options={{ presentation: "modal", animation: reducedMotion ? "none" : "slide_from_bottom" }} />
              <Stack.Screen name="deposit" options={{ presentation: "modal", animation: reducedMotion ? "none" : "slide_from_bottom" }} />
              <Stack.Screen name="withdraw" options={{ presentation: "modal", animation: reducedMotion ? "none" : "slide_from_bottom" }} />
            </Stack></BalancesProvider>
          </StellarWalletProvider>
        </MorosThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
