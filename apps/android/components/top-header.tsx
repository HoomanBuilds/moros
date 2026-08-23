import { View } from "react-native";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export function TopHeader() {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
      <Brand compact />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ThemeToggle />
      </View>
    </View>
  );
}
