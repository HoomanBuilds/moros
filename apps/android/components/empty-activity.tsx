import { ReceiptText } from "lucide-react-native";
import { Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function EmptyActivity({ compact = false }: { compact?: boolean }) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 24, padding: compact ? 22 : 30, backgroundColor: theme.surface, alignItems: "center" }}>
      <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <ReceiptText size={23} color={theme.accent} strokeWidth={1.7} />
      </View>
      <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 16 }}>Private activity unavailable</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 6 }}>Native identity recovery and encrypted activity sync must be connected before this device can show payment history.</Text>
    </View>
  );
}
