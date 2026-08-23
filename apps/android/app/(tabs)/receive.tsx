import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { Copy, Fingerprint, QrCode, Share2, WalletCards } from "lucide-react-native";
import { Share, Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { InfoRow } from "@/components/info-row";
import { PageHeading } from "@/components/page-heading";
import { Screen } from "@/components/screen";
import { TopHeader } from "@/components/top-header";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { useMorosTheme } from "@/providers/theme-provider";

export default function ReceiveScreen() {
  const { theme } = useMorosTheme();
  const code = "";

  async function copy() {
    if (code) await Clipboard.setStringAsync(code);
  }

  async function share() {
    if (code) await Share.share({ message: code, title: "Moros payment code" });
  }

  return (
    <Screen>
      <TopHeader />
      <PageHeading label="Receive privately" title="Your private code" description="Share one identity without exposing a public Stellar wallet." />
      <View style={{ borderRadius: 30, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, padding: 20 }}>
        <View style={{ aspectRatio: 1, borderRadius: 25, backgroundColor: theme.elevated, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <View style={{ position: "absolute", inset: 20, borderRadius: 24, borderWidth: 1, borderColor: theme.border }} />
          <View style={{ width: 106, height: 106, borderRadius: 30, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <QrCode size={48} color={theme.accent} strokeWidth={1.3} />
          </View>
          <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 14, marginTop: 18 }}>{paymentDeployment.ready ? "Mobile identity unavailable" : "Network setup required"}</Text>
          <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 12, marginTop: 5, textAlign: "center", maxWidth: 240 }}>{paymentDeployment.ready ? "Native identity derivation and secure storage are not connected in this build." : "A verified deployment must be connected first."}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
          <View style={{ flex: 1 }}><ActionButton label="Copy" icon={Copy} variant="secondary" onPress={() => void copy()} disabled={!code} /></View>
          <View style={{ flex: 1 }}><ActionButton label="Share" icon={Share2} onPress={() => void share()} disabled={!code} /></View>
        </View>
      </View>
      <View style={{ marginTop: 26, gap: 20, borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20 }}>
        <InfoRow icon={Fingerprint} title="Diversified recipient" description="New requests can use separate recipient identifiers recovered by the same private wallet." accent />
        <View style={{ height: 1, backgroundColor: theme.border }} />
        <InfoRow icon={WalletCards} title="No public wallet needed" description="Recipients can receive internally before opening or funding a Stellar account." />
      </View>
      <View style={{ marginTop: 18 }}><ActionButton label="Create signed request" icon={WalletCards} variant="secondary" onPress={() => router.push("/request")} /></View>
    </Screen>
  );
}
