import { RefreshCw, ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";
import { EmptyActivity } from "@/components/empty-activity";
import { PageHeading } from "@/components/page-heading";
import { Screen } from "@/components/screen";
import { TopHeader } from "@/components/top-header";
import { fonts } from "@/constants/theme";
import { useMorosTheme } from "@/providers/theme-provider";

export default function ActivityScreen() {
  const { theme } = useMorosTheme();
  return (
    <Screen>
      <TopHeader />
      <PageHeading label="Encrypted history" title="Private activity" description="Recover transfers and receipts without turning the server into a readable ledger." />
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 22 }}>
        {["All", "Sent", "Received", "Pending"].map((label, index) => (
          <View key={label} style={{ minHeight: 42, justifyContent: "center", paddingHorizontal: 15, borderRadius: 99, backgroundColor: index === 0 ? theme.inverse : theme.surface, borderWidth: 1, borderColor: index === 0 ? theme.inverse : theme.border }}>
            <Text style={{ color: index === 0 ? theme.onInverse : theme.muted, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={17} color={theme.accent} />
          <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 14 }}>Decrypted on this device</Text>
        </View>
        <RefreshCw size={17} color={theme.subtle} />
      </View>
      <EmptyActivity />
    </Screen>
  );
}
