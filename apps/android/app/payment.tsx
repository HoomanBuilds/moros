import { useLocalSearchParams } from "expo-router";
import { CheckCircle2, Clock3, Fingerprint, ShieldCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { AvailabilityNotice } from "@/components/availability-notice";
import { FormField } from "@/components/form-field";
import { InfoRow } from "@/components/info-row";
import { ModalHeader } from "@/components/modal-header";
import { Screen } from "@/components/screen";
import { fonts } from "@/constants/theme";
import { paymentDeployment } from "@/lib/deployment";
import { parsePaymentTarget } from "@/lib/payment-links";
import { parseUsdcAtomic } from "@/lib/usdc";
import { useMorosTheme } from "@/providers/theme-provider";

export default function PaymentReview() {
  const { theme } = useMorosTheme();
  const params = useLocalSearchParams<{ target?: string }>();
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [amountError, setAmountError] = useState("");
  const target = typeof params.target === "string" ? params.target : "";
  const result = useMemo(() => {
    try {
      return { value: parsePaymentTarget(target), error: "" };
    } catch (cause) {
      return { value: null, error: cause instanceof Error ? cause.message : "Invalid payment request." };
    }
  }, [target]);

  function review() {
    setAmountError("");
    setReviewed(false);
    try {
      parseUsdcAtomic(amount);
      setReviewed(true);
    } catch (cause) {
      setAmountError(cause instanceof Error ? cause.message : "Could not review this amount.");
    }
  }

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
            <Text style={{ color: theme.accentOnInverse, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2 }}>PRIVATE USDC</Text>
            <Text style={{ color: theme.onInverse, fontFamily: fonts.serif, fontSize: 44, lineHeight: 48, marginTop: 12 }}>{result.value?.kind === "request" ? "Signed request" : "Direct payment"}</Text>
            <Text style={{ color: theme.onInverse, opacity: 0.65, fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, marginTop: 10 }}>The app recognized this Moros payment format. Cryptographic request verification is required before submission.</Text>
          </View>
          <FormField label="Amount" value={amount} onChangeText={(value) => { setAmount(value); setReviewed(false); setAmountError(""); }} placeholder="0.00" keyboardType="decimal-pad" suffix="USDC" helper="The final amount and relay fee must be shown before approval." />
          <View style={{ borderRadius: 26, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 20 }}>
            <InfoRow icon={CheckCircle2} title="Moros format recognized" description="The scanner accepted the code structure and approved Moros domain." accent />
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <InfoRow icon={Fingerprint} title="Private payload present" description="Recipient details remain inside the encoded request until native verification is connected." />
            <View style={{ height: 1, backgroundColor: theme.border }} />
            <InfoRow icon={Clock3} title="Expiry checked locally" description="Expired signed requests are rejected before submission." />
          </View>
          {!paymentDeployment.ready ? (
            <View style={{ borderRadius: 20, backgroundColor: theme.accentSoft, padding: 16, flexDirection: "row", gap: 10 }}>
              <ShieldCheck size={18} color={theme.accent} />
              <Text style={{ color: theme.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, flex: 1 }}>{paymentDeployment.reason}. No transaction can be prepared in this build.</Text>
            </View>
          ) : null}
          {amountError ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 }}>{amountError}</Text> : null}
          {!reviewed ? (
            <ActionButton label="Review amount" onPress={review} disabled={!paymentDeployment.ready || !amount} />
          ) : (
            <View style={{ gap: 12 }}>
              <AvailabilityNotice title="Private transfer not connected" description="The amount passed local checks. Native request verification, proof creation, and relay submission are not connected in this mobile build." />
              <ActionButton label="Private transfer unavailable" onPress={() => undefined} disabled />
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}
