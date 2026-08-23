import { ArrowDownToLine, CircleDollarSign, ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";
import { formatUsdcAtomic, useBalances } from "@/providers/balances-provider";

export function PrivateBalanceCard({ onDeposit }: { onDeposit(): void }) {
  const { theme } = useMorosTheme();
  const { privateBalance } = useBalances();
  return (
    <View style={{ backgroundColor: theme.inverse, borderRadius: 30, minHeight: 310, overflow: "hidden", padding: 24 }}>
      <View pointerEvents="none" style={{ position: "absolute", right: -72, bottom: -95, width: 280, height: 280, borderRadius: 140, borderWidth: 1, borderColor: theme.accent }}>
        <View style={{ position: "absolute", left: 44, top: 44, width: 190, height: 190, borderRadius: 95, borderWidth: 1, borderColor: theme.accent, opacity: 0.65 }} />
        <View style={{ position: "absolute", left: 84, top: 84, width: 110, height: 110, borderRadius: 55, backgroundColor: theme.accent }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <CircleDollarSign size={18} color={theme.onInverse} strokeWidth={1.7} />
          <Text style={{ color: theme.onInverse, fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.7 }}>PRIVATE USDC</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.accent, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 99 }}>
          <ShieldCheck size={13} color={theme.accent} />
          <Text style={{ color: theme.accent, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1 }}>ENCRYPTED</Text>
        </View>
      </View>
      <View style={{ marginTop: 56 }}>
        <Text style={{ color: theme.onInverse, fontFamily: fonts.serif, fontSize: 66, lineHeight: 70, letterSpacing: -2.5 }}>{formatUsdcAtomic(privateBalance.spendableAtomic)}</Text>
        <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2, marginTop: 4 }}>AVAILABLE PRIVATELY</Text>
      </View>
      <View style={{ marginTop: "auto", maxWidth: 180 }}>
        <ActionButton label="Add USDC" icon={ArrowDownToLine} onPress={onDeposit} />
      </View>
    </View>
  );
}
