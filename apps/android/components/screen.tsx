import type { ReactNode } from "react";
import { ScrollView, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMorosTheme } from "@/providers/theme-provider";

export function Screen({ children, scroll = true, contentContainerStyle, ...props }: ScrollViewProps & { children: ReactNode; scroll?: boolean }) {
  const { theme } = useMorosTheme();
  const content = (
    <View style={[{ flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 126 }, contentContainerStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} {...props}>
          {content}
        </ScrollView>
      ) : content}
    </SafeAreaView>
  );
}
