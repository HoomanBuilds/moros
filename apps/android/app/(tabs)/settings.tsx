import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Database, Fingerprint, KeyRound, Moon, ShieldCheck, Smartphone, Sun, SunMoon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { InfoRow } from "@/components/info-row";
import { PageHeading } from "@/components/page-heading";
import { Screen } from "@/components/screen";
import { TopHeader } from "@/components/top-header";
import { fonts, type ThemeMode } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { useMorosTheme } from "@/providers/theme-provider";

const modes: { mode: ThemeMode; label: string; icon: typeof SunMoon }[] = [
  { mode: "system", label: "System", icon: SunMoon },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
];

export default function SettingsScreen() {
  const { theme, mode, setMode } = useMorosTheme();

  async function replayOnboarding() {
    await AsyncStorage.removeItem("moros_pay_onboarding_complete");
    router.replace("/onboarding");
  }

  return (
    <Screen>
      <TopHeader />
      <PageHeading label="Local control" title="Wallet settings" description="Control appearance, recovery, device access, and payment-network status." />
      <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>APPEARANCE</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8, padding: 6, borderRadius: 22, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
        {modes.map(({ mode: itemMode, label, icon: Icon }) => {
          const active = mode === itemMode;
          return (
            <Pressable
              key={itemMode}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => setMode(itemMode)}
              style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, backgroundColor: active ? theme.inverse : pressed ? theme.accentSoft : "transparent" })}
            >
              <Icon size={17} color={active ? theme.onInverse : theme.muted} strokeWidth={1.7} />
              <Text style={{ color: active ? theme.onInverse : theme.muted, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2, marginTop: 32, marginBottom: 12 }}>PRIVATE WALLET</Text>
      <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
        <InfoRow icon={Fingerprint} title="Payment identity" description={paymentDeployment.ready ? "Ready for local identity derivation." : "Waiting for a verified payment deployment."} accent />
        <View style={{ height: 1, backgroundColor: theme.border }} />
        <InfoRow icon={KeyRound} title="Recovery phrase" description="Spending and viewing keys stay protected by this device and your recovery words." />
        <View style={{ height: 1, backgroundColor: theme.border }} />
        <InfoRow icon={Database} title="Encrypted sync" description="Only padded ciphertext archives are accepted by the recovery service." />
      </View>
      <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2, marginTop: 32, marginBottom: 12 }}>APP</Text>
      <Pressable onPress={() => void replayOnboarding()} style={({ pressed }) => ({ minHeight: 64, borderRadius: 20, borderWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.accentSoft : theme.surface, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 12 })}>
        <Smartphone size={19} color={theme.text} />
        <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 14, flex: 1 }}>Replay welcome screens</Text>
      </Pressable>
      <View style={{ marginTop: 14, borderRadius: 20, backgroundColor: theme.accentSoft, padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <ShieldCheck size={18} color={theme.accent} />
          <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 13 }}>Stellar private payments</Text>
        </View>
        <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 6 }}>Circle USDC settlement with note ownership and internal payment details protected.</Text>
      </View>
    </Screen>
  );
}
