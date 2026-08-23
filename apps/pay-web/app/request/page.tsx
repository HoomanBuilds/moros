"use client";

import { Check, Copy, Share2 } from "lucide-react";
import QRCode from "qrcode";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { usePaymentWallet } from "@/components/wallet-provider";
import { paymentDeployment } from "@/lib/deployment";
import { createPaymentRequest } from "@/lib/payment-identity";

export default function RequestPage() {
  const wallet = usePaymentWallet();
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");
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
      const value = await createPaymentRequest({
        phrase: wallet.recoveryPhrase,
        deployment: paymentDeployment.deployment,
        amountAtomic,
        merchantLabel: label,
        expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      });
      setLink(value);
      setQr(await QRCode.toDataURL(value, { width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#050505", light: "#ffffff" } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the payment request.");
    } finally {
      setPending(false);
    }
  }

  async function copy() { await navigator.clipboard.writeText(link); setCopied(true); }
  async function share() { if (navigator.share) await navigator.share({ title: "Moros payment request", url: link }); else await copy(); }

  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Signed request" title="Request USDC" description="Create a tamper-evident request that expires automatically." />
        <form className="panel formStack" onSubmit={submit}>
          <div className="segmented" aria-label="Payment request amount type">
            <button type="button" className={fixed ? "active" : ""} onClick={() => setFixed(true)}>Fixed amount</button>
            <button type="button" className={!fixed ? "active" : ""} onClick={() => setFixed(false)}>Payer chooses</button>
          </div>
          {fixed && <label className="field"><span>Amount</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>}
          <label className="field"><span>Display name, optional</span><input value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} placeholder="Coffee counter" /></label>
          <p className="finePrint">Request expires in 24 hours. The signature protects the recipient, asset, amount, and expiry from modification.</p>
          {error && <p className="errorText" role="alert">{error}</p>}
          <button className="button primary" disabled={pending || !paymentDeployment.ready || (fixed && !amount)}>{pending ? "Signing request..." : "Create request"}</button>
        </form>
        {link && (
          <section className="panel formStack" style={{ marginTop: 16 }}>
            <div className="qrCard"><Image src={qr} alt="QR code for this private USDC payment request" width={720} height={720} unoptimized /></div>
            <div className="codeBlock">{link}</div>
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
