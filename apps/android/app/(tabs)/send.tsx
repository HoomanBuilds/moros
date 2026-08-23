import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router } from "expo-router";
import { Camera, ClipboardPaste, ScanLine } from "lucide-react-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { FormField } from "@/components/form-field";
import { PageHeading } from "@/components/page-heading";
import { Screen } from "@/components/screen";
import { TopHeader } from "@/components/top-header";
import { fonts } from "@/constants/theme";
import { parsePaymentTarget } from "@/lib/payment-links";
import { useMorosTheme } from "@/providers/theme-provider";

export default function SendScreen() {
  const { theme } = useMorosTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanner, setScanner] = useState(false);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const consumed = useRef(false);

  function review(value = target) {
    try {
      parsePaymentTarget(value);
      setError("");
      router.push({ pathname: "/payment", params: { target: value } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This payment code is invalid.");
    }
  }

  function scan(result: BarcodeScanningResult) {
    if (consumed.current) return;
    consumed.current = true;
    setTarget(result.data);
    setScanner(false);
    review(result.data);
  }

  async function openScanner() {
    setError("");
    consumed.current = false;
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        setError("Camera access is needed to scan a payment code. You can paste one instead.");
        return;
      }
    }
    setScanner(true);
  }

  return (
    <Screen scroll={!scanner}>
      <TopHeader />
      <PageHeading label="Private transfer" title="Scan to send" description="Recognize a Moros payment code locally before opening its payment review." />
      {scanner ? (
        <View style={{ flex: 1 }}>
          <View style={{ height: 390, borderRadius: 30, overflow: "hidden", backgroundColor: theme.inverse }}>
            <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={scan} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} />
            <View pointerEvents="none" style={{ position: "absolute", left: 48, right: 48, top: 78, height: 220, borderRadius: 28, borderWidth: 2, borderColor: theme.accent }}>
              <View style={{ position: "absolute", left: 16, right: 16, top: "50%", height: 1, backgroundColor: theme.accent }} />
            </View>
          </View>
          <Text style={{ color: theme.muted, fontFamily: fonts.sans, fontSize: 13, textAlign: "center", marginTop: 16 }}>Keep the full Moros code inside the frame.</Text>
          <View style={{ marginTop: 18 }}><ActionButton label="Cancel scanning" variant="secondary" onPress={() => setScanner(false)} /></View>
        </View>
      ) : (
        <View style={{ gap: 18 }}>
          <View style={{ borderRadius: 28, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, padding: 20 }}>
            <View style={{ height: 184, borderRadius: 22, backgroundColor: theme.inverse, alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <View style={{ width: 108, height: 108, borderRadius: 26, borderWidth: 1, borderColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
                <ScanLine size={48} color={theme.accent} strokeWidth={1.3} />
              </View>
            </View>
            <ActionButton label="Open QR scanner" icon={Camera} onPress={() => void openScanner()} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ height: 1, backgroundColor: theme.border, flex: 1 }} />
            <Text style={{ color: theme.subtle, fontFamily: fonts.medium, fontSize: 11 }}>OR PASTE</Text>
            <View style={{ height: 1, backgroundColor: theme.border, flex: 1 }} />
          </View>
          <FormField label="Moros code or payment link" icon={ClipboardPaste} multiline value={target} onChangeText={setTarget} placeholder="moros_pay_..." autoCapitalize="none" autoCorrect={false} />
          {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 }}>{error}</Text> : null}
          <ActionButton label="Review private payment" onPress={() => review()} disabled={!target.trim()} />
        </View>
      )}
    </Screen>
  );
}
