"use client";

import { Check, Copy, RefreshCw, Share2 } from "lucide-react";
import { PaymentQr } from "@/components/payment-qr";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";
import { copyBrowserText, shareBrowserText } from "@/lib/browser-share";

export default function ReceivePage() {
  return <ProtectedPage><ReceiveContent /></ProtectedPage>;
}

function ReceiveContent() {
  const wallet = usePaymentWallet();
  const rotation = useRef(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState("");
  const code = wallet.identity?.paymentCode ?? "";

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
    if (rotation.current) return;
    rotation.current = true;
    setRotating(true);
    setError("");
    setCopied(false);
    try {
      await wallet.rotateReceiveIdentity();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a new private payment code.");
    } finally {
      rotation.current = false;
      setRotating(false);
    }
  }

  return <div className="page transactionPage">
    <PageHeader title="Receive USDC" description="Share your code with someone paying from Moros." />
    {!code ? <div className="notice"><strong>Payment code unavailable</strong><p>Try unlocking your wallet again.</p></div> : <section className="panel formStack receivePanel">
      <PaymentQr value={code} label="Your Moros receive code" />
      <p className="receiveIdentity">{wallet.identity?.recipientFingerprint}</p>
      <div className="actionRow receiveActions">
        <button className="button secondary" type="button" disabled={rotating} onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Copied" : "Copy code"}</button>
        <button className="button primary" type="button" disabled={rotating} onClick={share}><Share2 size={18} />Share</button>
      </div>
      {error && <p className="errorText" role="alert">{error}</p>}
      <details className="paymentHelp"><summary>Payment code details</summary>
        <p className="codeBlock">{code}</p>
        <p>You can create a new code at any time. Older codes will still receive payments.</p>
        <button className="textButton" type="button" onClick={rotate} disabled={rotating || wallet.profile.status !== "ready"}><RefreshCw size={16} />{rotating ? "Creating..." : "New private code"}</button>
      </details>
    </section>}
  </div>;
}
