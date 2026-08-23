import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { PressableScale } from "@/components/pressable-scale";
import { useMorosTheme } from "@/providers/theme-provider";

type Props = {
  label: string;
  onPress(): void;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  accessibilityHint?: string;
};

export function ActionButton({ label, onPress, icon: Icon, variant = "primary", disabled, accessibilityHint }: Props) {
  const { theme } = useMorosTheme();
  const primary = variant === "primary";
  const quiet = variant === "quiet";
  return (
    <PressableScale haptic={primary && !disabled} onPress={onPress} disabled={disabled} accessibilityLabel={label} accessibilityHint={accessibilityHint}>
      <View style={{
        minHeight: 56,
        borderRadius: 18,
        borderWidth: quiet ? 0 : 1,
        borderColor: primary ? theme.inverse : theme.border,
        backgroundColor: primary ? theme.inverse : quiet ? "transparent" : theme.surface,
        opacity: disabled ? 0.45 : 1,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}>
        {Icon ? <Icon size={19} color={primary ? theme.onInverse : theme.text} strokeWidth={1.8} /> : null}
        <Text style={{ color: primary ? theme.onInverse : theme.text, fontFamily: fonts.semibold, fontSize: 15 }}>{label}</Text>
      </View>
    </PressableScale>
  );
}
