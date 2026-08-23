import { LockKeyhole } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMorosTheme } from "@/providers/theme-provider";

export function TopHeader({ showLock = false }: { showLock?: boolean }) {
  const { theme } = useMorosTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
      <Brand compact />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ThemeToggle />
        {showLock ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lock private wallet"
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.accentSoft : theme.surface,
            })}
          >
            <LockKeyhole size={18} color={theme.text} strokeWidth={1.7} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
