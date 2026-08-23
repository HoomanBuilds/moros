import * as Haptics from "expo-haptics";
import { useRef } from "react";
import { Animated, Easing, Pressable, type PressableProps } from "react-native";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

type Props = PressableProps & {
  haptic?: boolean;
  pressedScale?: number;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({ haptic, pressedScale = 0.975, onPressIn, onPressOut, style, children, ...props }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPressIn={(event) => {
        scale.stopAnimation();
        if (!reducedMotion) Animated.timing(scale, { toValue: pressedScale, duration: 90, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.stopAnimation();
        if (!reducedMotion) Animated.timing(scale, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        onPressOut?.(event);
      }}
      style={(state) => [typeof style === "function" ? style(state) : style, { transform: [{ scale }] }]}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}
