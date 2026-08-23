import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function InfoRow({ icon: Icon, title, description, accent = false }: { icon: LucideIcon; title: string; description: string; accent?: boolean }) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ flexDirection: "row", gap: 13, alignItems: "flex-start" }}>
      <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: accent ? theme.accentSoft : theme.elevated, alignItems: "center", justifyContent: "center" }}>
        <Icon size={19} color={accent ? theme.accent : theme.text} strokeWidth={1.7} />
      </View>
      <View style={{ flex: 1, paddingTop: 1 }}>
        <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 14 }}>{title}</Text>
        <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, marginTop: 3 }}>{description}</Text>
      </View>
    </View>
  );
}
