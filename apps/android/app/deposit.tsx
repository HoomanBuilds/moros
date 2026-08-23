import { ArrowDownToLine, ExternalLink, ShieldCheck, WalletCards } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { FormField } from "@/components/form-field";
import { InfoRow } from "@/components/info-row";
import { ModalHeader } from "@/components/modal-header";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { useMorosTheme } from "@/providers/theme-provider";
import { isValidStellarAccount, shortStellarAccount } from "@/lib/stellar-account";
import { formatUsdcAtomic, useBalances } from "@/providers/balances-provider";

export default function DepositScreen() {
  const { theme } = useMorosTheme();
  const [amount, setAmount] = useState("");
  const [accountInput, setAccountInput] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const { publicBalance, pairPublicAccount, clearPublicAccount } = useBalances();

  async function pair() {
    setPairError(null);
    try {
      await pairPublicAccount(accountInput);
      setAccountInput("");
    } catch (cause) {
      setPairError(cause instanceof Error ? cause.message : "Could not pair the Stellar account.");
    }
  }
  return (
    <Screen>
      <ModalHeader title="Add private USDC" />
      <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 44, lineHeight: 47, letterSpacing: -1.2 }}>Shield once. Pay many times.</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 26 }}>Move Circle USDC from a Stellar wallet into a reusable private balance.</Text>
      <View style={{ gap: 20 }}>
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 14 }}>
          <InfoRow icon={WalletCards} title="Funding wallet" description={publicBalance.account ? `${shortStellarAccount(publicBalance.account)} · ${formatUsdcAtomic(publicBalance.balanceAtomic)} public USDC` : "Pair the public Stellar account that will approve deposits."} accent />
          {publicBalance.account ? (
            <ActionButton label="Change funding wallet" variant="secondary" onPress={() => void clearPublicAccount()} />
          ) : (
            <>
              <FormField label="Stellar public account" value={accountInput} onChangeText={(value) => setAccountInput(value.trim().toUpperCase())} placeholder="G..." autoCapitalize="characters" autoCorrect={false} maxLength={56} />
              {pairError ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13 }}>{pairError}</Text> : null}
              <ActionButton label="Pair funding wallet" variant="secondary" onPress={() => void pair()} disabled={!isValidStellarAccount(accountInput)} />
            </>
          )}
        </View>
        <FormField label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" />
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
          <InfoRow icon={ExternalLink} title="Stellar funding boundary" description="Review the source wallet, asset, amount, and network before signing." />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={ShieldCheck} title="Private after shielding" description="Internal recipients, transfers, note ownership, and balances stay protected." accent />
        </View>
        {!paymentDeployment.ready ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13 }}>{paymentDeployment.reason}</Text> : null}
        <ActionButton label="Review deposit" icon={ArrowDownToLine} onPress={() => {}} disabled={!paymentDeployment.ready || !publicBalance.account || publicBalance.accountActive !== true || publicBalance.hasTrustline !== true || !amount} />
      </View>
    </Screen>
  );
}
