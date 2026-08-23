import { Image, Text, View } from "react-native";
import { Check, CircleDollarSign, LockKeyhole, ShieldCheck } from "lucide-react-native";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

const frame = { width: 260, height: 252 } as const;

export function PrivatePaymentIllustration() {
  const { theme } = useMorosTheme();
  return (
    <View accessibilityLabel="Moros private USDC wallet" style={[frame, { alignItems: "center", justifyContent: "center" }]}>
      <View style={{ position: "absolute", width: 212, height: 212, borderRadius: 106, backgroundColor: theme.accentSoft }} />
      <View style={{ width: 164, height: 164, borderRadius: 82, backgroundColor: theme.inverse, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 14 }, shadowOpacity: theme.dark ? 0.35 : 0.16, shadowRadius: 24, elevation: 8 }}>
        <Image source={require("@/assets/icon.png")} style={{ width: 112, height: 112, borderRadius: 34 }} accessibilityIgnoresInvertColors />
      </View>
      <View style={{ position: "absolute", right: 2, top: 32, minHeight: 48, borderRadius: 18, paddingHorizontal: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LockKeyhole size={17} color={theme.accent} strokeWidth={1.8} />
        <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.2 }}>PRIVATE</Text>
      </View>
      <View style={{ position: "absolute", left: 0, bottom: 29, minHeight: 48, borderRadius: 18, paddingHorizontal: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <CircleDollarSign size={17} color={theme.text} strokeWidth={1.8} />
        <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.2 }}>USDC</Text>
      </View>
    </View>
  );
}

export function ScanPaymentIllustration() {
  const { theme } = useMorosTheme();
  return (
    <View accessibilityLabel="A verified Moros QR payment" style={[frame, { alignItems: "center", justifyContent: "center" }]}>
      <View style={{ position: "absolute", width: 210, height: 210, borderRadius: 105, backgroundColor: theme.accentSoft }} />
      <View style={{ width: 150, height: 220, borderRadius: 38, padding: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, shadowColor: "#000", shadowOffset: { width: 0, height: 14 }, shadowOpacity: theme.dark ? 0.34 : 0.14, shadowRadius: 24, elevation: 8 }}>
        <View style={{ flex: 1, borderRadius: 25, backgroundColor: theme.elevated, borderWidth: 1, borderColor: theme.border, padding: 15 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><QrBlock /><QrBlock /></View>
          <View style={{ position: "absolute", left: 14, right: 14, top: "50%", height: 2, borderRadius: 1, backgroundColor: theme.accent }} />
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 9, marginTop: "auto" }}><QrBlock /><View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: theme.text }} /></View>
        </View>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.accentSoft, alignSelf: "center", alignItems: "center", justifyContent: "center", marginTop: 12 }}>
          <Check size={18} color={theme.accent} strokeWidth={2.2} />
        </View>
      </View>
    </View>
  );
}

export function ReusableBalanceIllustration() {
  const { theme } = useMorosTheme();
  return (
    <View accessibilityLabel="A reusable private USDC balance" style={[frame, { justifyContent: "center" }]}>
      <View style={{ width: 260, minHeight: 190, borderRadius: 34, padding: 22, backgroundColor: theme.inverse, overflow: "hidden" }}>
        <View style={{ position: "absolute", width: 180, height: 180, borderRadius: 90, right: -54, bottom: -72, borderWidth: 1, borderColor: theme.accent }} />
        <View style={{ position: "absolute", width: 112, height: 112, borderRadius: 56, right: -20, bottom: -38, backgroundColor: theme.accent }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={17} color={theme.accent} strokeWidth={1.7} />
          <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.5 }}>PRIVATE USDC</Text>
        </View>
        <Text style={{ color: theme.onInverse, fontFamily: fonts.serif, fontSize: 58, letterSpacing: -2, marginTop: 26 }}>0.00</Text>
        <Text style={{ color: theme.onInverse, opacity: 0.58, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.4, marginTop: 2 }}>REUSABLE BALANCE</Text>
      </View>
    </View>
  );
}

function QrBlock() {
  const { theme } = useMorosTheme();
  return (
    <View style={{ width: 33, height: 33, borderRadius: 7, borderWidth: 4, borderColor: theme.text, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: theme.text }} />
    </View>
  );
}
