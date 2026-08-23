import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, ScrollView, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionButton } from "@/components/action-button";
import { Brand } from "@/components/brand";
import { PrivatePaymentIllustration, ReusableBalanceIllustration, ScanPaymentIllustration } from "@/components/onboarding-illustrations";
import { ThemeToggle } from "@/components/theme-toggle";
import { fonts } from "@/constants/theme";
import { ONBOARDING_KEY } from "@/app/index";
import { useMorosTheme } from "@/providers/theme-provider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const pages = [
  {
    label: "PRIVATE PAYMENTS",
    title: "Move money.\nKeep it yours.",
    description: "Use a reusable private balance for protected Circle USDC payments on Stellar.",
    Illustration: PrivatePaymentIllustration,
  },
  {
    label: "SCAN AND VERIFY",
    title: "Point. Verify.\nPay privately.",
    description: "Scan a Moros code or open a payment link, then review its recipient and amount before approval.",
    Illustration: ScanPaymentIllustration,
  },
  {
    label: "ONE PRIVATE BALANCE",
    title: "Shield once.\nUse it anywhere.",
    description: "Connect the Stellar wallet you already use. Moros adds a separate private identity for payments, requests, withdrawals, and markets.",
    Illustration: ReusableBalanceIllustration,
  },
] as const;

export default function Onboarding() {
  const { width, height } = useWindowDimensions();
  const { theme } = useMorosTheme();
  const list = useRef<FlatList<(typeof pages)[number]>>(null);
  const [page, setPage] = useState(0);
  const reducedMotion = useReducedMotion();
  const compact = height < 700 || width < 360;
  const progress = useRef(pages.map((_, index) => new Animated.Value(index === 0 ? 1 : 0))).current;

  const finish = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    router.replace("/(tabs)");
  }, []);

  const next = useCallback(() => {
    if (page === pages.length - 1) {
      void finish();
      return;
    }
    list.current?.scrollToOffset({ offset: (page + 1) * width, animated: true });
    setPage(page + 1);
  }, [finish, page, width]);

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  useEffect(() => {
    const animation = Animated.parallel(progress.map((value, index) => Animated.timing(value, { toValue: index === page ? 1 : 0, duration: reducedMotion ? 0 : 220, useNativeDriver: true })));
    animation.start();
    return () => animation.stop();
  }, [page, progress, reducedMotion]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8 }}>
        <Brand />
        <ThemeToggle />
      </View>
      <FlatList
        ref={list}
        data={pages}
        horizontal
        pagingEnabled
        bounces={false}
        initialNumToRender={pages.length}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        keyExtractor={(item) => item.label}
        renderItem={({ item }) => (
          <ScrollView
            style={{ width }}
            contentContainerStyle={{ minHeight: "100%", paddingHorizontal: compact ? 22 : 28, paddingVertical: 18, justifyContent: "center", alignItems: "center" }}
            showsVerticalScrollIndicator={false}
            directionalLockEnabled
          >
            <View style={{ width: 260, height: compact ? 204 : 252, marginBottom: compact ? 14 : 30, alignItems: "center", justifyContent: "center" }}>
              <View style={{ transform: [{ scale: compact ? 0.8 : 1 }] }}><item.Illustration /></View>
            </View>
            <Text style={{ color: theme.accentText, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2.4, marginBottom: 14 }}>{item.label}</Text>
            <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: compact ? 40 : 48, lineHeight: compact ? 41 : 49, letterSpacing: -1.3, textAlign: "center" }}>{item.title}</Text>
            <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: compact ? 14 : 16, lineHeight: compact ? 21 : 24, textAlign: "center", marginTop: compact ? 13 : 18, maxWidth: 340 }}>{item.description}</Text>
          </ScrollView>
        )}
      />
      <View style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
        <View accessibilityLabel={`Page ${page + 1} of ${pages.length}`} style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 22 }}>
          {pages.map((item, index) => (
            <Animated.View key={item.label} style={{ width: 28, height: 8, borderRadius: 4, backgroundColor: theme.accent, opacity: progress[index].interpolate({ inputRange: [0, 1], outputRange: [0.22, 1] }), transform: [{ scaleX: progress[index].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {page < pages.length - 1 ? <View style={{ flex: 1 }}><ActionButton label="Skip" variant="secondary" onPress={() => void finish()} /></View> : null}
          <View style={{ flex: 1 }}><ActionButton label={page === pages.length - 1 ? "Open Moros" : "Continue"} onPress={next} /></View>
        </View>
      </View>
    </SafeAreaView>
  );
}
