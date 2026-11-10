"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

export function PaymentQr({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState<{ value: string; data?: string; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void import("qrcode").then((module) => module.default.toDataURL(value, { width: 600, margin: 3, errorCorrectionLevel: "M", color: { dark: "#302c30", light: "#ffffff" } }))
      .then((data) => { if (active) setResult({ value, data }); })
      .catch(() => { if (active) setResult({ value, error: "QR code unavailable. You can still copy or share the payment code below." }); });
    return () => { active = false; };
  }, [value]);
  if (result?.value !== value) return <div className="qrPlaceholder" role="status">Preparing QR code...</div>;
  if (!result.data) return <p className="finePrint" role="status">{result.error}</p>;
  return <div className="qrCard"><Image src={result.data} width={600} height={600} alt={label} unoptimized /></div>;
}
