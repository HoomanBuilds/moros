import { ArrowDownToLine, ArrowUpRight, QrCode, ShieldCheck, WalletCards } from "lucide-react-native";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { EmptyActivity } from "@/components/empty-activity";
import { PrivateBalanceCard } from "@/components/private-balance-card";
import { QuickAction } from "@/components/quick-action";
import { Screen } from "@/components/screen";
import { TopHeader } from "@/components/top-header";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { useMorosTheme } from "@/providers/theme-provider";
import { BalanceStrip } from "@/components/balance-strip";
import { AvailabilityNotice } from "@/components/availability-notice";

export default function HomeScreen() {
  const { theme } = useMorosTheme();
  return (
    <Screen>
      <TopHeader />
      <View style={{ marginBottom: 24 }}>
        <Text style={{ color: theme.muted, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2.2 }}>PRIVATE BALANCE</Text>
        <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 45, lineHeight: 48, letterSpacing: -1.2, marginTop: 10 }}>Your money, without the map.</Text>
      </View>
      <PrivateBalanceCard onDeposit={() => router.push("/deposit")} />
      <BalanceStrip />
      <View style={{ marginTop: 14 }}>
        <AvailabilityNotice
          title={paymentDeployment.ready ? "Mobile private wallet not connected" : paymentDeployment.reason}
          description={paymentDeployment.ready ? "The interface is ready, but native identity storage, proving, encrypted sync, and submission are not connected in this build." : "Private actions remain locked until this build has a verified deployment manifest."}
        />
      </View>
      <View style={{ marginTop: 34, marginBottom: 15, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <Text style={{ color: theme.accentText, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2 }}>MOVE PRIVATELY</Text>
          <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 29, marginTop: 4 }}>What do you need?</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <QuickAction icon={ArrowUpRight} label="Send" detail="Scan or paste" accent onPress={() => router.push("/(tabs)/send")} />
        <QuickAction icon={QrCode} label="Receive" detail="Share your code" onPress={() => router.push("/(tabs)/receive")} />
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
        <QuickAction icon={WalletCards} label="Request" detail="Signed request" onPress={() => router.push("/request")} />
        <QuickAction icon={ArrowDownToLine} label="Withdraw" detail="To Stellar" onPress={() => router.push("/withdraw")} />
      </View>
      <View style={{ marginTop: 36, borderTopWidth: 1, borderColor: theme.border, paddingTop: 22 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <ShieldCheck size={18} color={theme.accent} strokeWidth={1.7} />
          <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 14 }}>Locally decrypted activity</Text>
        </View>
        <EmptyActivity compact />
      </View>
    </Screen>
  );
}
