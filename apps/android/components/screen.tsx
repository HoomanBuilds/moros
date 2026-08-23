import { useEffect, useRef, type ReactNode } from "react";
import { Animated, ScrollView, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useMorosTheme } from "@/providers/theme-provider";

export function Screen({ children, scroll = true, contentContainerStyle, ...props }: ScrollViewProps & { children: ReactNode; scroll?: boolean }) {
  const { theme } = useMorosTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translate.setValue(0);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, translate]);

  const content = (
    <Animated.View style={[{ flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 126, opacity, transform: [{ translateY: translate }] }, contentContainerStyle]}>
      {children}
    </Animated.View>
  );

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.background }}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} {...props}>
          {content}
        </ScrollView>
      ) : content}
    </SafeAreaView>
  );
}
