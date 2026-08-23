import { ShieldCheck } from "lucide-react-native";
import { Text, View } from "react-native";
import { AvailabilityNotice } from "@/components/availability-notice";
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
      <View style={{ marginBottom: 22 }}>
        <AvailabilityNotice title="Encrypted activity not connected" description="This build does not derive the native private identity or decrypt synchronized payment outputs yet, so no activity filters or records are shown." />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={17} color={theme.accent} />
          <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 14 }}>Decrypted on this device</Text>
        </View>
        <Text style={{ color: theme.subtle, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.4 }}>LOCAL</Text>
      </View>
      <EmptyActivity />
    </Screen>
  );
}
