import { RefreshCw, WalletCards } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { fonts } from "@/constants/theme";
import { formatUsdcAtomic, useBalances } from "@/providers/balances-provider";
import { useMorosTheme } from "@/providers/theme-provider";

export function BalanceStrip() {
  const { theme } = useMorosTheme();
  const { publicBalance, privateBalance, refreshPublicBalance } = useBalances();
  const loading = publicBalance.status === "loading";
  return (
    <View style={{ marginTop: 14, borderWidth: 1, borderColor: theme.border, borderRadius: 24, backgroundColor: theme.surface, overflow: "hidden" }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 1, minHeight: 92, padding: 16, borderRightWidth: 1, borderColor: theme.border }}>
          <Text style={{ color: theme.muted, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 1.3 }}>PRIVATE WALLET</Text>
          <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 25, marginTop: 10 }}>{privateBalance.status === "ready" ? "Ready" : "Unavailable"}</Text>
          <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 11, marginTop: 3 }}>native wallet state</Text>
        </View>
        <View style={{ flex: 1.35, minHeight: 92, padding: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.muted, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 1.3 }}>PUBLIC WALLET</Text>
            {publicBalance.account ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Refresh public balance" onPress={() => void refreshPublicBalance()} disabled={loading} hitSlop={10}>
                <RefreshCw size={15} color={theme.muted} />
              </Pressable>
            ) : <WalletCards size={15} color={theme.muted} />}
          </View>
          <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 29, marginTop: 8 }}>{formatUsdcAtomic(publicBalance.balanceAtomic)}</Text>
          <Text numberOfLines={1} style={{ color: publicBalance.error ? theme.danger : theme.muted, fontFamily: fonts.sans, fontSize: 11, marginTop: 3 }}>{publicBalance.account ? publicBalance.accountActive === false ? "Account not active" : publicBalance.hasTrustline === false ? "USDC trustline needed" : loading ? "Refreshing" : "Circle USDC" : "Pair when adding USDC"}</Text>
        </View>
      </View>
    </View>
  );
}
