import type { LucideIcon } from "lucide-react-native";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

type Props = TextInputProps & {
  label: string;
  helper?: string;
  icon?: LucideIcon;
  suffix?: string;
};

export function FormField({ label, helper, icon: Icon, suffix, style, ...props }: Props) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 13 }}>{label}</Text>
      <View style={{ minHeight: props.multiline ? 120 : 58, flexDirection: "row", alignItems: props.multiline ? "flex-start" : "center", borderWidth: 1, borderColor: theme.border, borderRadius: 18, backgroundColor: theme.surface, paddingHorizontal: 16 }}>
        {Icon ? <Icon size={18} color={theme.muted} strokeWidth={1.7} style={{ marginRight: 10, marginTop: props.multiline ? 18 : 0 }} /> : null}
        <TextInput
          placeholderTextColor={theme.subtle}
          selectionColor={theme.accent}
          style={[{ flex: 1, minHeight: props.multiline ? 118 : 56, color: theme.text, fontFamily: fonts.sans, fontSize: 16, textAlignVertical: props.multiline ? "top" : "center", paddingVertical: props.multiline ? 16 : 0 }, style]}
          accessibilityLabel={label}
          {...props}
        />
        {suffix ? <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 13 }}>{suffix}</Text> : null}
      </View>
      {helper ? <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 }}>{helper}</Text> : null}
    </View>
  );
}
