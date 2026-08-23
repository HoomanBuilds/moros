import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";
import { PressableScale } from "@/components/pressable-scale";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function QuickAction({ icon: Icon, label, detail, onPress, accent = false }: { icon: LucideIcon; label: string; detail: string; onPress(): void; accent?: boolean }) {
  const { theme } = useMorosTheme();
  return (
    <PressableScale onPress={onPress} haptic accessibilityLabel={label} accessibilityHint={detail} style={{ flex: 1 }}>
      <View style={{ minHeight: 142, borderRadius: 24, padding: 18, backgroundColor: accent ? theme.accentSoft : theme.surface, borderWidth: 1, borderColor: accent ? theme.accent : theme.border }}>
        <View style={{ width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: accent ? theme.accent : theme.elevated }}>
          <Icon size={20} color={accent ? theme.onAccent : theme.text} strokeWidth={1.8} />
        </View>
        <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 15, marginTop: 20 }}>{label}</Text>
        <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 12, marginTop: 3 }}>{detail}</Text>
      </View>
    </PressableScale>
  );
}
