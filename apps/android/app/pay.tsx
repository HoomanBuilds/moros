import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export default function PaymentLinkEntry() {
  const { theme } = useMorosTheme();
  const url = Linking.useURL();

  useEffect(() => {
    if (url) router.replace({ pathname: "/payment", params: { target: url } });
  }, [url]);

  return (
    <Screen scroll={false} contentContainerStyle={{ alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.accent }} />
      </View>
      <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 34, marginTop: 20 }}>Opening request</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 14, marginTop: 8 }}>Checking the Moros payment-link format locally.</Text>
    </Screen>
  );
}
