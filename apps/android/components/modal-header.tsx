import { X } from "lucide-react-native";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export function ModalHeader({ title }: { title: string }) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 30 }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 30 }}>{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.accentSoft : theme.surface, borderWidth: 1, borderColor: theme.border })}
      >
        <X size={20} color={theme.text} strokeWidth={1.7} />
      </Pressable>
    </View>
  );
}
