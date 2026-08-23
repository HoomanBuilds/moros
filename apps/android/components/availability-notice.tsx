import { CircleGauge } from "lucide-react-native";
import { Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function AvailabilityNotice({ title, description }: { title: string; description: string }) {
  const { theme } = useMorosTheme();
  return (
    <View accessibilityRole="alert" style={{ borderRadius: 20, backgroundColor: theme.accentSoft, padding: 16, flexDirection: "row", gap: 11 }}>
      <CircleGauge size={19} color={theme.accent} strokeWidth={1.8} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 13 }}>{title}</Text>
        <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 4 }}>{description}</Text>
      </View>
    </View>
  );
}
