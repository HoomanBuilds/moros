import { Clock3, Link2, LockKeyhole, WalletCards } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { AvailabilityNotice } from "@/components/availability-notice";
import { FormField } from "@/components/form-field";
import { InfoRow } from "@/components/info-row";
import { ModalHeader } from "@/components/modal-header";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { parseUsdcAtomic } from "@/lib/usdc";
import { useMorosTheme } from "@/providers/theme-provider";

export default function RequestPayment() {
  const { theme } = useMorosTheme();
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState(24 * 60 * 60);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");

  function review() {
    setError("");
    setReviewed(false);
    try {
      if (fixed) parseUsdcAtomic(amount);
      setReviewed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review this payment request.");
    }
  }

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
            onPress={() => { setFixed(item.value); setReviewed(false); setError(""); }}
            style={({ pressed }) => ({ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: fixed === item.value ? theme.inverse : pressed ? theme.accentSoft : "transparent" })}
          >
            <Text style={{ color: fixed === item.value ? theme.onInverse : theme.muted, fontFamily: fonts.medium, fontSize: 13 }}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 18 }}>
        {fixed ? <FormField label="Amount" value={amount} onChangeText={(value) => { setAmount(value); setReviewed(false); setError(""); }} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" /> : null}
        <FormField label="Display name, optional" value={label} onChangeText={(value) => { setLabel(value); setReviewed(false); }} placeholder="Coffee counter" maxLength={64} />
        <View>
          <Text style={{ color: theme.text, fontFamily: fonts.semibold, fontSize: 13, marginBottom: 9 }}>Request expires</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              { label: "15 min", value: 15 * 60 },
              { label: "1 hour", value: 60 * 60 },
              { label: "24 hours", value: 24 * 60 * 60 },
              { label: "7 days", value: 7 * 24 * 60 * 60 },
            ].map((item) => {
              const active = expiry === item.value;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => { setExpiry(item.value); setReviewed(false); }}
                  style={({ pressed }) => ({ minHeight: 48, minWidth: "47%", flexGrow: 1, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 1, borderColor: active ? theme.inverse : theme.border, backgroundColor: active ? theme.inverse : pressed ? theme.accentSoft : theme.surface })}
                >
                  <Text style={{ color: active ? theme.onInverse : theme.muted, fontFamily: fonts.medium, fontSize: 13 }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
          <InfoRow icon={Clock3} title={`Expires in ${expiry === 900 ? "15 minutes" : expiry === 3600 ? "1 hour" : expiry === 86400 ? "24 hours" : "7 days"}`} description="Old requests are rejected before payment preparation." />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={LockKeyhole} title="Signed on this device" description="Recipient, asset, amount, and expiry cannot be modified after sharing." accent />
          <View style={{ height: 1, backgroundColor: theme.border }} />
          <InfoRow icon={Link2} title="QR and private link" description="Use the same request in person or remotely." />
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 }}>{error}</Text> : null}
        {!reviewed ? (
          <ActionButton label="Review signed request" icon={WalletCards} onPress={review} disabled={!paymentDeployment.ready || (fixed && !amount)} />
        ) : (
          <View style={{ gap: 12 }}>
            <AvailabilityNotice title="Request signing not connected" description="The request details passed local checks. This mobile build cannot derive the private receive identity or sign the request yet." />
            <ActionButton label="Request signing unavailable" icon={WalletCards} onPress={() => undefined} disabled />
          </View>
        )}
      </View>
    </Screen>
  );
}
