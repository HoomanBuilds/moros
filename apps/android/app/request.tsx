import { Clock3, Link2, LockKeyhole, WalletCards } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { FormField } from "@/components/form-field";
import { InfoRow } from "@/components/info-row";
import { ModalHeader } from "@/components/modal-header";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { useMorosTheme } from "@/providers/theme-provider";

export default function RequestPayment() {
  const { theme } = useMorosTheme();
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");

  return (
    <Screen>
      <ModalHeader title="Request USDC" />
      <Text style={{ color: theme.text, fontFamily: fonts.serif, fontSize: 44, lineHeight: 47, letterSpacing: -1.2 }}>Create a request only you can sign.</Text>
      <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 26 }}>Share a tamper-evident QR code or link for a private payment.</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", padding: 6, borderRadius: 22, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, marginBottom: 20 }}>
        {[{ label: "Fixed amount", value: true }, { label: "Payer chooses", value: false }].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="radio"
            accessibilityState={{ checked: fixed === item.value }}
            onPress={() => setFixed(item.value)}
            style={({ pressed }) => ({ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: fixed === item.value ? theme.inverse : pressed ? theme.accentSoft : "transparent" })}
          >
            <Text style={{ color: fixed === item.value ? theme.onInverse : theme.muted, fontFamily: fonts.medium, fontSize: 13 }}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 18 }}>
        {fixed ? <FormField label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" /> : null}
        <FormField label="Display name, optional" value={label} onChangeText={setLabel} placeholder="Coffee counter" maxLength={64} />
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
          <InfoRow icon={Clock3} title="Expires in 24 hours" description="Old requests are rejected before payment preparation." />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={LockKeyhole} title="Signed on this device" description="Recipient, asset, amount, and expiry cannot be modified after sharing." accent />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={Link2} title="QR and private link" description="Use the same request in person or remotely." />
        </View>
        <ActionButton label="Create signed request" icon={WalletCards} onPress={() => {}} disabled={!paymentDeployment.ready || (fixed && !amount)} />
      </View>
    </Screen>
  );
}
