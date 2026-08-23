"use client";

import { Check, Copy, Link2, Share2 } from "lucide-react";
import QRCode from "qrcode";
import Image from "next/image";
import { FormEvent, useState } from "react";
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
  const wallet = usePaymentWallet();
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [expirySeconds, setExpirySeconds] = useState(24 * 60 * 60);
  const [link, setLink] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!wallet.recoveryPhrase || !paymentDeployment.ready) return;
    setPending(true);
    setError("");
    try {
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const amountAtomic = fixed ? core.parse_usdc_amount(amount) : undefined;
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
      setQr(await QRCode.toDataURL(value, { width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#050505", light: "#ffffff" } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the payment request.");
    } finally {
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

  return (
    <ProtectedPage>
      <div className="page transactionPage">
        <PageHeader eyebrow="Signed request" title="Request USDC" description="Create a tamper-evident request that expires automatically." />
        <div className="transactionLayout">
        <form className="panel formStack transactionForm" onSubmit={submit}>
          <div className="segmented" role="radiogroup" aria-label="Payment request amount type">
            <button type="button" role="radio" aria-checked={fixed} className={fixed ? "active" : ""} onClick={() => setFixed(true)}>Fixed amount</button>
            <button type="button" role="radio" aria-checked={!fixed} className={!fixed ? "active" : ""} onClick={() => setFixed(false)}>Payer chooses</button>
          </div>
          {fixed && <label className="field"><span>Amount</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>}
          <label className="field"><span>Display name, optional</span><input value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} placeholder="Coffee counter" /></label>
          <fieldset className="expiryField">
            <legend>Request expires</legend>
            <div className="expiryOptions">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  className={expirySeconds === option.seconds ? "active" : ""}
                  key={option.seconds}
                  type="button"
                  aria-pressed={expirySeconds === option.seconds}
                  onClick={() => setExpirySeconds(option.seconds)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="finePrint">Each request gets a fresh private receive identity. Its signature protects the recipient, asset, amount, and expiry from modification.</p>
          {error && <p className="errorText" role="alert">{error}</p>}
          <button className="button primary" disabled={pending || !paymentDeployment.ready || (fixed && !amount)}>{pending ? "Signing request..." : "Create request"}</button>
        </form>
        <aside className="transactionAside">
          <p className="eyebrow">Request properties</p>
          <div className="asideMetric"><span>Recipient identity</span><strong>Fresh for every request</strong></div>
          <div className="asideMetric"><span>Integrity</span><strong>Signed and tamper-evident</strong></div>
          <div className="asideMetric"><span>Storage</span><strong>Encrypted private profile</strong></div>
          <p className="finePrint">Only the person holding this link can inspect and pay the request.</p>
        </aside>
        </div>
        {link && (
          <section className="panel formStack createdRequest">
            <div className="createdRequestHeader"><span><Check size={16} />Ready to share</span><small>Saved to encrypted activity</small></div>
            <div className="qrCard"><Image src={qr} alt="QR code for this private USDC payment request" width={720} height={720} unoptimized /></div>
            <div className="recipientPreview"><p className="eyebrow">Recipient fingerprint</p><p className="fingerprint">{fingerprint}</p></div>
            <div className="codeBlock">{link}</div>
            <div className="actionRow">
              <button className="button secondary" type="button" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Copied" : "Copy"}</button>
              <button className="button primary" type="button" onClick={share}><Share2 size={18} />Share</button>
            </div>
          </section>
        )}
        <section className="requestManager">
          <div className="panelHeader">
            <div><p className="eyebrow">Private request book</p><h2>Your requests</h2><p>Recovered from the encrypted profile on this device.</p></div>
            <span className="requestCount"><Link2 size={14} />{wallet.profile.value?.paymentRequests.length ?? 0}</span>
          </div>
          {(wallet.profile.value?.paymentRequests.length ?? 0) > 0 ? (
            <PaymentRequestList
              requests={wallet.profile.value?.paymentRequests ?? []}
              onCancel={(requestId) => wallet.updatePaymentRequestStatus(requestId, "cancelled")}
            />
          ) : (
            <div className="compactEmpty"><Link2 size={19} /><span>No signed requests yet.</span></div>
          )}
        </section>
      </div>
    </ProtectedPage>
  );
}
