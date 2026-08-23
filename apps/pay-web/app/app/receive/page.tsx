"use client";

import { Check, Copy, RefreshCw, Share2 } from "lucide-react";
import QRCode from "qrcode";
import Image from "next/image";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";
import { copyBrowserText, shareBrowserText } from "@/lib/browser-share";

export default function ReceivePage() {
  const wallet = usePaymentWallet();
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState("");
  const code = wallet.identity?.paymentCode ?? "";

  useEffect(() => {
    let active = true;
    if (!code) return;
    QRCode.toDataURL(code, { width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#050505", light: "#ffffff" } })
      .then((value) => active && setQr(value));
    return () => { active = false; };
  }, [code]);

  async function copy() {
    setError("");
    try {
      await copyBrowserText(code);
      setCopied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy this payment code.");
    }
  }
  async function share() {
    setError("");
    try {
      const result = await shareBrowserText({ title: "Moros payment code", text: code });
      if (result === "copied") setCopied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not share this payment code.");
    }
  }
  async function rotate() {
    setRotating(true);
    setError("");
    setQr("");
    setCopied(false);
    try {
      await wallet.rotateReceiveIdentity();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a new private payment code.");
    } finally {
      setRotating(false);
    }
  }

  return (
    <ProtectedPage>
      <div className="page transactionPage">
        <PageHeader eyebrow="Receive privately" title="Your payment code" description="Share a private identity that contains no public Stellar wallet address. Create a fresh code whenever you want less linkability." />
        {!code ? (
          <div className="notice"><strong>Payment identity unavailable</strong><p>Connect a verified payment deployment to derive this wallet&apos;s payment code.</p></div>
        ) : (
          <div className="transactionLayout receiveLayout">
          <section className="panel formStack transactionForm">
            {qr && <div className="qrCard"><Image src={qr} alt="QR code for this Moros payment identity" width={720} height={720} unoptimized /></div>}
            <div className="receiveCodeMeta">
              <div><p className="eyebrow">Receive identity</p><p className="fingerprint">#{wallet.profile.value?.activeReceiveIndex ?? 0}</p></div>
              <button className="button secondary compactButton" type="button" onClick={rotate} disabled={rotating || wallet.profile.status !== "ready"}>
                <RefreshCw size={16} />{rotating ? "Creating..." : "New private code"}
              </button>
            </div>
            <div><p className="eyebrow">Recipient fingerprint</p><p className="fingerprint">{wallet.identity?.recipientFingerprint}</p></div>
            <div className="codeBlock">{code}</div>
            {error && <p className="errorText" role="alert">{error}</p>}
            <div className="actionRow">
              <button className="button secondary" type="button" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Copied" : "Copy"}</button>
              <button className="button primary" type="button" onClick={share}><Share2 size={18} />Share</button>
            </div>
          </section>
          <aside className="transactionAside"><p className="eyebrow">Diversified receive</p><div className="asideMetric"><span>Public wallet</span><strong>Not embedded</strong></div><div className="asideMetric"><span>Private identity</span><strong>Rotatable anytime</strong></div><div className="asideMetric"><span>Recovery</span><strong>Backed up privately</strong></div><p className="finePrint">Use a fresh code for a new person or context to reduce linkability between incoming payments.</p></aside>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
