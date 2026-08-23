import { Clock3, Home, QrCode, ScanLine, Settings } from "lucide-react-native";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export default function TabsLayout() {
  const { theme } = useMorosTheme();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 10 : 8);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.subtle,
        tabBarHideOnKeyboard: true,
        animation: reducedMotion ? "none" : "fade",
        transitionSpec: {
          animation: "timing",
          config: { duration: reducedMotion ? 0 : 180 },
        },
        tabBarStyle: {
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 8,
          height: 66 + bottomInset,
          paddingTop: 10,
          paddingBottom: bottomInset,
          borderRadius: 26,
          borderTopWidth: 1,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.elevated,
          elevation: theme.dark ? 0 : 10,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: theme.dark ? 0.3 : 0.09,
          shadowRadius: 18,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 10,
          marginTop: 3,
        },
        tabBarItemStyle: {
          borderRadius: 18,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <Home size={21} color={color} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="send" options={{ title: "Scan", tabBarIcon: ({ color }) => <ScanLine size={22} color={color} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="receive" options={{ title: "Receive", tabBarIcon: ({ color }) => <QrCode size={21} color={color} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: ({ color }) => <Clock3 size={21} color={color} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => <Settings size={21} color={color} strokeWidth={1.8} /> }} />
    </Tabs>
  );
}
