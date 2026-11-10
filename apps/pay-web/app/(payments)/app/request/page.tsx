"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { StepHeading } from "@/components/step-heading";
import { PaymentQr } from "@/components/payment-qr";
import { parsePaymentAmount } from "@/lib/payment-review";
import { FormEvent, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { PaymentRequestList } from "@/components/payment-request-list";
import { UsdcIcon } from "@/components/payment-icons";
import { usePaymentWallet } from "@/components/wallet-provider";
import { copyBrowserText, shareBrowserText } from "@/lib/browser-share";
import { paymentDeployment } from "@/lib/deployment";
import { createPaymentRequest, verifyPaymentRequest } from "@/lib/payment-identity";

const EXPIRY_OPTIONS = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

export default function RequestPage() {
  return <ProtectedPage><RequestContent /></ProtectedPage>;
}

function RequestContent() {
  const wallet = usePaymentWallet();
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [expirySeconds, setExpirySeconds] = useState(24 * 60 * 60);
  const [link, setLink] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const creating = useRef(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!wallet.recoveryPhrase || !paymentDeployment.ready || creating.current) return;
    creating.current = true;
    setPending(true);
    setError("");
    try {
      const amountAtomic = fixed ? parsePaymentAmount(amount).toString() : undefined;
      if (new TextEncoder().encode(label.trim()).length > 64) throw new Error("Keep the display name within 64 bytes.");
      const childIndex = await wallet.reserveRequestIdentity();
      const now = Math.floor(Date.now() / 1000);
      const value = await createPaymentRequest({
        phrase: wallet.recoveryPhrase,
        deployment: paymentDeployment.deployment,
        childIndex: BigInt(childIndex),
        amountAtomic,
        merchantLabel: label,
        now,
        expiresAt: now + expirySeconds,
      });
      const verified = await verifyPaymentRequest(value, paymentDeployment.deployment, now);
      await wallet.savePaymentRequest({
        requestId: verified.requestId,
        paymentLink: value,
        recipientFingerprint: verified.recipientFingerprint,
        label: verified.merchantLabel,
        amountAtomic: verified.amountAtomic,
        createdAt: verified.createdAt,
        expiresAt: verified.expiresAt,
        updatedAt: Date.now(),
        status: "active",
      });
      setLink(value);
      setFingerprint(verified.recipientFingerprint);
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the payment request.");
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  async function copy() {
    setError("");
    try {
      await copyBrowserText(link);
      setCopied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy this request.");
    }
  }

  async function share() {
    setError("");
    try {
      const result = await shareBrowserText({ title: "Moros payment request", url: link });
      if (result === "copied") setCopied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not share this request.");
    }
  }

  return <div className="page">
    <PageHeader title="Request USDC" description="Choose an amount and share a payment link." />
    <div className="requestWorkspace">
      {!link ? <form className="panel formStack" onSubmit={submit}>
        <fieldset className="formFields" disabled={pending}>
          <div className="segmented" aria-label="Payment request amount type">
            <button type="button" aria-pressed={fixed} className={fixed ? "active" : ""} onClick={() => setFixed(true)}>Fixed amount</button>
            <button type="button" aria-pressed={!fixed} className={!fixed ? "active" : ""} onClick={() => setFixed(false)}>Payer chooses</button>
          </div>
          {fixed && <label className="field"><span>Amount</span><span className="amountBox"><input aria-label="USDC amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>}
          <label className="field"><span>Display name, optional</span><input value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} placeholder="Your name or business" /></label>
          <fieldset className="expiryField"><legend>Expires after</legend><div className="expiryOptions">{EXPIRY_OPTIONS.map((option) => <button className={expirySeconds === option.seconds ? "active" : ""} key={option.seconds} type="button" aria-pressed={expirySeconds === option.seconds} onClick={() => setExpirySeconds(option.seconds)}>{option.label}</button>)}</div></fieldset>
          <p className="finePrint">Anyone with the link can see the amount and display name.</p>
          {error && <p className="errorText" role="alert">{error}</p>}
          <button className="button primary" disabled={pending || !paymentDeployment.ready || (fixed && !amount)}>{pending ? "Creating request..." : "Create request"}</button>
        </fieldset>
      </form> : <section className="panel formStack createdRequest">
        <StepHeading as="h2">Request created</StepHeading>
        <PaymentQr value={link} label="Your signed USDC payment request" />
        <div className="actionRow receiveActions"><button className="button secondary" type="button" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Copied" : "Copy link"}</button><button className="button primary" type="button" onClick={share}><Share2 size={18} />Share</button></div>
        <details className="paymentHelp"><summary>Request details</summary><p className="fingerprint">Recipient: {fingerprint}</p><p className="codeBlock">{link}</p></details>
        {error && <p className="errorText" role="alert">{error}</p>}
        <button className="textButton" onClick={() => { setLink(""); setAmount(""); setLabel(""); setError(""); }}>Create another request</button>
      </section>}
      <section className="requestManager">
        <div className="panelHeader"><h2>Your requests</h2></div>
        {(wallet.profile.value?.paymentRequests.length ?? 0) > 0 ? <PaymentRequestList requests={wallet.profile.value?.paymentRequests ?? []} onCancel={(requestId) => wallet.updatePaymentRequestStatus(requestId, "cancelled")} /> : <div className="requestEmpty"><p>No requests yet</p><span>New requests will appear here.</span></div>}
      </section>
    </div>
  </div>;
}
