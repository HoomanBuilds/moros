import { ArrowUpFromLine, Eye, ShieldCheck, Wallet } from "lucide-react-native";
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

export default function WithdrawScreen() {
  const { theme } = useMorosTheme();
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <Screen>
      <ModalHeader title="Withdraw USDC" />
      <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 44, lineHeight: 47, letterSpacing: -1.2 }}>Exit to any funded Stellar account.</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 26 }}>Spend private notes and receive normal Circle USDC at the destination.</Text>
      <View style={{ gap: 18 }}>
        <FormField label="Stellar destination" icon={Wallet} value={account} onChangeText={(value) => setAccount(value.trim().toUpperCase())} placeholder="G..." autoCapitalize="characters" autoCorrect={false} maxLength={56} />
        <FormField label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" />
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
          <InfoRow icon={ShieldCheck} title="Private source notes" description="The proof spends private notes without revealing their ownership or earlier transfers." accent />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={Eye} title="Visible Stellar destination" description="The destination account and final withdrawal amount are recorded on Stellar." />
        </View>
        <ActionButton label="Review withdrawal" icon={ArrowUpFromLine} onPress={() => {}} disabled={!paymentDeployment.ready || account.length !== 56 || !amount} />
      </View>
    </Screen>
  );
}
