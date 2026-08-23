import { Image, Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function Brand({ compact = false }: { compact?: boolean }) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
      <Image source={require("@/assets/icon.png")} accessibilityIgnoresInvertColors style={{ width: compact ? 29 : 34, height: compact ? 29 : 34, borderRadius: compact ? 8 : 10 }} />
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: compact ? 25 : 30 }}>Moros</Text>
        <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 2.5 }}>/ PAY</Text>
      </View>
    </View>
  );
}
