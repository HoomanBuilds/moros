import { Moon, Sun } from "lucide-react-native";
import { Pressable } from "react-native";
import { useMorosTheme } from "@/providers/theme-provider";

export function ThemeToggle() {
  const { theme, setMode } = useMorosTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={theme.dark ? "Use light theme" : "Use dark theme"}
      hitSlop={8}
      onPress={() => setMode(theme.dark ? "light" : "dark")}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.accentSoft : theme.surface,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      {theme.dark ? <Sun size={19} color={theme.text} strokeWidth={1.7} /> : <Moon size={19} color={theme.text} strokeWidth={1.7} />}
    </Pressable>
  );
}
