import { Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function PageHeading({ label, title, description }: { label: string; title: string; description: string }) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 15 }}>
        <View style={{ width: 28, height: 1, backgroundColor: theme.border }} />
        <Text style={{ color: theme.muted, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2 }}>{label.toUpperCase()}</Text>
      </View>
      <Text accessibilityRole="header" style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 43, lineHeight: 45, letterSpacing: -1.2 }}>{title}</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 16, lineHeight: 24, marginTop: 12 }}>{description}</Text>
    </View>
  );
}
