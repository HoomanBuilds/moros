import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useMorosTheme } from "@/providers/theme-provider";

export const ONBOARDING_KEY = "moros_pay_onboarding_complete";

export default function Index() {
  const { theme } = useMorosTheme();
  const [complete, setComplete] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((value) => setComplete(value === "true"));
  }, []);

  if (complete === null) return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  return <Redirect href={complete ? "/(tabs)" : "/onboarding"} />;
}
