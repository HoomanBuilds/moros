import { useLocalSearchParams } from "expo-router";
import { CheckCircle2, Clock3, Fingerprint, ShieldCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { FormField } from "@/components/form-field";
import { InfoRow } from "@/components/info-row";
import { ModalHeader } from "@/components/modal-header";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { parsePaymentTarget } from "@/lib/payment-links";
import { useMorosTheme } from "@/providers/theme-provider";

export default function PaymentReview() {
  const { theme } = useMorosTheme();
  const params = useLocalSearchParams<{ target?: string }>();
  const [amount, setAmount] = useState("");
  const target = typeof params.target === "string" ? params.target : "";
  const result = useMemo(() => {
    try {
      return { value: parsePaymentTarget(target), error: "" };
    } catch (cause) {
      return { value: null, error: cause instanceof Error ? cause.message : "Invalid payment request." };
    }
  }, [target]);

  return (
    <Screen>
      <ModalHeader title="Review payment" />
      {result.error ? (
        <View style={{ borderRadius: 24, backgroundColor: theme.accentSoft, padding: 22 }}>
          <Text style={{ color: theme.danger, fontFamily: fonts.semibold, fontSize: 15 }}>Request cannot be verified</Text>
          <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, marginTop: 7 }}>{result.error}</Text>
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          <View style={{ backgroundColor: theme.inverse, borderRadius: 30, padding: 24 }}>
            <Text style={{ color: theme.accent, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2 }}>PRIVATE USDC</Text>
            <Text style={{ color: theme.onInverse, fontFamily: fonts.serif, fontSize: 44, lineHeight: 48, marginTop: 12 }}>{result.value?.kind === "request" ? "Signed request" : "Direct payment"}</Text>
            <Text style={{ color: theme.onInverse, opacity: 0.65, fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, marginTop: 10 }}>The full request is checked on this device before proof preparation.</Text>
          </View>
          <FormField label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" helper="The final amount and relay fee are shown before approval." />
          <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
            <InfoRow icon={CheckCircle2} title="Request format verified" description="The code belongs to the approved Moros payment format." accent />
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <InfoRow icon={Fingerprint} title="Recipient protected" description="The recipient is represented by an encrypted note key, not a public wallet address." />
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <InfoRow icon={Clock3} title="Expiry checked locally" description="Expired signed requests are rejected before submission." />
          </View>
          {!paymentDeployment.ready ? (
            <View style={{ borderRadius: 20, backgroundColor: theme.accentSoft, padding: 16, flexDirection: "row", gap: 10 }}>
              <ShieldCheck size={18} color={theme.accent} />
              <Text style={{ color: theme.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, flex: 1 }}>{paymentDeployment.reason}. No transaction can be prepared in this build.</Text>
            </View>
          ) : null}
          <ActionButton label="Continue privately" onPress={() => {}} disabled={!paymentDeployment.ready || !amount} />
        </View>
      )}
    </Screen>
  );
}
