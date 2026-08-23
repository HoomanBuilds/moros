"use client";

import { Check, Copy, Share2 } from "lucide-react";
import QRCode from "qrcode";
import Image from "next/image";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";

export default function ReceivePage() {
  const wallet = usePaymentWallet();
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const code = wallet.identity?.paymentCode ?? "";

  useEffect(() => {
    let active = true;
    if (!code) return;
    QRCode.toDataURL(code, { width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#050505", light: "#ffffff" } })
      .then((value) => active && setQr(value));
    return () => { active = false; };
  }, [code]);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }
  async function share() {
    if (navigator.share) await navigator.share({ title: "Moros payment code", text: code });
    else await copy();
  }

  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Receive privately" title="Your payment code" description="Share this reusable identity. It contains no public Stellar wallet address." />
        {!code ? (
          <div className="notice"><strong>Payment identity unavailable</strong><p>Connect a verified payment deployment to derive this wallet&apos;s payment code.</p></div>
        ) : (
          <section className="panel formStack">
            {qr && <div className="qrCard"><Image src={qr} alt="QR code for this Moros payment identity" width={720} height={720} unoptimized /></div>}
            <div><p className="eyebrow">Recipient fingerprint</p><p className="fingerprint">{wallet.identity?.recipientFingerprint}</p></div>
            <div className="codeBlock">{code}</div>
            <div className="actionRow">
              <button className="button secondary" type="button" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Copied" : "Copy"}</button>
              <button className="button primary" type="button" onClick={share}><Share2 size={18} />Share</button>
            </div>
          </section>
        )}
      </div>
    </ProtectedPage>
  );
}
