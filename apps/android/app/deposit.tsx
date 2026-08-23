import * as Clipboard from "expo-clipboard";
import { ArrowDownToLine, Copy, ExternalLink, ShieldCheck, WalletCards } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { ActionButton } from "@/components/action-button";
import { AvailabilityNotice } from "@/components/availability-notice";
import { FormField } from "@/components/form-field";
import { InfoRow } from "@/components/info-row";
import { ModalHeader } from "@/components/modal-header";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { useMorosTheme } from "@/providers/theme-provider";
import { shortStellarAccount } from "@/lib/stellar-account";
import { formatUsdcAtomic, useBalances } from "@/providers/balances-provider";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { parseUsdcAtomic } from "@/lib/usdc";

export default function DepositScreen() {
  const { theme } = useMorosTheme();
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const { publicBalance } = useBalances();
  const wallet = useStellarWallet();
  const connecting = wallet.status === "connecting" || wallet.status === "initializing";

  function review() {
    setError("");
    setReviewed(false);
    try {
      const atomic = parseUsdcAtomic(amount);
      if (!publicBalance.account || wallet.status !== "ready") throw new Error("Connect a Stellar wallet before reviewing this deposit.");
      if (publicBalance.accountActive !== true) throw new Error("This Stellar account must be funded before depositing USDC.");
      if (publicBalance.hasTrustline !== true) throw new Error("Enable the Circle USDC trustline before depositing.");
      if (publicBalance.balanceAtomic !== null && atomic > publicBalance.balanceAtomic) throw new Error("This deposit exceeds the public USDC balance.");
      setReviewed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review this deposit.");
    }
  }
  return (
    <Screen>
      <ModalHeader title="Add private USDC" />
      <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 44, lineHeight: 47, letterSpacing: -1.2 }}>Shield once. Pay many times.</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 26 }}>Move Circle USDC from a Stellar wallet into a reusable private balance.</Text>
      <View style={{ gap: 20 }}>
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 14 }}>
          <InfoRow icon={WalletCards} title="Existing Stellar wallet" description={publicBalance.account ? `${wallet.walletName ?? "Stellar wallet"} · ${shortStellarAccount(publicBalance.account)} · ${formatUsdcAtomic(publicBalance.balanceAtomic)} public USDC` : "Connect the wallet you already use. It keeps custody and approves every public transaction."} accent />
          {publicBalance.account ? (
            <ActionButton label="Disconnect wallet" variant="secondary" onPress={() => void wallet.disconnect()} />
          ) : (
            <ActionButton label={connecting ? "Waiting for wallet" : "Connect existing wallet"} variant="secondary" onPress={() => void wallet.connect()} disabled={wallet.status === "unavailable" || connecting} />
          )}
          {wallet.pairingUri ? (
            <View style={{ alignItems: "center", gap: 12, borderRadius: 22, backgroundColor: theme.background, padding: 16 }}>
              <View style={{ backgroundColor: "#FFFFFF", padding: 10, borderRadius: 16 }}>
                <QRCode value={wallet.pairingUri} size={168} backgroundColor="#FFFFFF" color="#080808" />
              </View>
              <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, textAlign: "center" }}>Open a compatible Stellar wallet on this device, or scan this code from another device.</Text>
              <View style={{ width: "100%", gap: 8 }}>
                <ActionButton label="Open Stellar wallet" variant="secondary" onPress={() => void wallet.openWallet()} />
                <ActionButton label="Open Freighter" variant="secondary" onPress={() => void wallet.openWallet("freighter")} />
                <ActionButton label="Copy pairing code" icon={Copy} variant="secondary" onPress={() => void Clipboard.setStringAsync(wallet.pairingUri as string)} />
                <ActionButton label="Cancel" variant="secondary" onPress={() => void wallet.cancelConnection()} />
              </View>
            </View>
          ) : null}
          {wallet.error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13 }}>{wallet.error}</Text> : null}
        </View>
        <FormField label="Amount" value={amount} onChangeText={(value) => { setAmount(value); setReviewed(false); setError(""); }} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" />
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
          <InfoRow icon={ExternalLink} title="Stellar funding boundary" description="Review the source wallet, asset, amount, and network before signing." />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={ShieldCheck} title="Private after shielding" description="Internal recipients, transfers, note ownership, and balances stay protected." accent />
        </View>
        {!paymentDeployment.ready ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13 }}>{paymentDeployment.reason}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 }}>{error}</Text> : null}
        {!reviewed ? (
          <ActionButton label="Review deposit" icon={ArrowDownToLine} onPress={review} disabled={!paymentDeployment.ready || wallet.status !== "ready" || !amount} />
        ) : (
          <View style={{ gap: 12 }}>
            <AvailabilityNotice title="Deposit proving not connected" description="The amount and wallet checks passed locally. This mobile build cannot create or submit the private deposit proof yet." />
            <ActionButton label="Deposit unavailable" icon={ArrowDownToLine} onPress={() => undefined} disabled />
          </View>
        )}
      </View>
    </Screen>
  );
}
