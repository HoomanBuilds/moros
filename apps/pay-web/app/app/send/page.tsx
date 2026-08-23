"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, EyeOff, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { usePaymentWallet } from "@/components/wallet-provider";
import { paymentDeployment } from "@/lib/deployment";
import {
  verifyDirectPaymentCode,
  verifyPaymentRequest,
  type PaymentIdentityView,
} from "@/lib/payment-identity";
import { formatUsdcAtomic } from "@/lib/public-usdc";

type PreparedRecipient = PaymentIdentityView & {
  label?: string;
  fixedAmount: boolean;
  amountAtomic: string;
};

export default function SendPage() {
  const wallet = usePaymentWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [prepared, setPrepared] = useState<PreparedRecipient | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const contacts = wallet.profile.value?.contacts ?? [];
  const recents = wallet.profile.value?.recentRecipients ?? [];
  const suggestions = [...contacts, ...recents.filter((recent) => (
    !contacts.some((contact) => contact.paymentCode === recent.paymentCode)
  ))].slice(0, 6);

  function changeRecipient(value: string) {
    setRecipient(value);
    setPrepared(null);
    setError("");
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!paymentDeployment.ready) return;
    setPending(true);
    setPrepared(null);
    setError("");
    try {
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const value = recipient.trim();
      if (value.length > 4_096) throw new Error("This payment target is too large.");
      if (value.includes("/pay#")) {
        const request = await verifyPaymentRequest(value, paymentDeployment.deployment);
        const amountAtomic = request.amountAtomic ?? core.parse_usdc_amount(amount);
        if (request.amountAtomic) setAmount(core.format_usdc_amount(request.amountAtomic));
        if (wallet.balance.spendableAtomic !== null && BigInt(amountAtomic) > wallet.balance.spendableAtomic) {
          throw new Error("This payment exceeds your available private USDC.");
        }
        setPrepared({
          paymentCode: request.paymentCode,
          recipientFingerprint: request.recipientFingerprint,
          label: request.merchantLabel,
          fixedAmount: Boolean(request.amountAtomic),
          amountAtomic,
        });
      } else {
        const amountAtomic = core.parse_usdc_amount(amount);
        if (wallet.balance.spendableAtomic !== null && BigInt(amountAtomic) > wallet.balance.spendableAtomic) {
          throw new Error("This payment exceeds your available private USDC.");
        }
        setPrepared({
          ...await verifyDirectPaymentCode(value, paymentDeployment.deployment),
          fixedAmount: false,
          amountAtomic,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify this private transfer.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ProtectedPage>
      <div className="page transactionPage">
        <PageHeader eyebrow="Private transfer" title="Send USDC" description="Pay a verified Moros identity without publishing the recipient or amount." />
        <div className="transactionLayout">
        <form className="panel formStack transactionForm" onSubmit={prepare}>
          {suggestions.length > 0 && (
            <section className="recipientSuggestions" aria-label="Private contacts and recent recipients">
              <p className="eyebrow"><Users size={13} /> Private contacts</p>
              <div>
                {suggestions.map((contact) => (
                  <button key={contact.paymentCode} type="button" onClick={() => changeRecipient(contact.paymentCode)}>
                    <span>{contact.label.slice(0, 1).toUpperCase()}</span>
                    <strong>{contact.label}</strong>
                    <small>{contact.recipientFingerprint}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
          <label className="field"><span>Payment code or signed request</span><textarea rows={4} maxLength={4096} value={recipient} onChange={(event) => changeRecipient(event.target.value)} placeholder="moros_pay_... or https://pay.moros.fun/pay#..." autoComplete="off" required /></label>
          <label className="field"><span className="fieldHeading"><span>Amount</span>{wallet.balance.spendableAtomic !== null && <button className="textButton" type="button" onClick={() => { setAmount(formatUsdcAtomic(wallet.balance.spendableAtomic)); setPrepared(null); }}>Use max</button>}</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); if (!prepared?.fixedAmount) setPrepared(null); }} placeholder="0.00" aria-label="USDC amount" readOnly={prepared?.fixedAmount} required /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>
          <label className="field"><span>Private note, optional</span><input value={memo} maxLength={96} onChange={(event) => setMemo(event.target.value)} placeholder="Only the recipient can read this" /></label>
          <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Verified before proving</strong><small>Moros checks the code checksum, network, private vault, request signature, asset, and expiry locally.</small></div></div>
          {!paymentDeployment.ready && <p className="errorText">Connect a verified payment deployment before preparing a transfer.</p>}
          {error && <p className="errorText" role="alert">{error}</p>}
          {!prepared && <button className="button primary" disabled={pending || !paymentDeployment.ready || !recipient.trim()}>{pending ? "Verifying..." : "Review private transfer"}</button>}
          {prepared && (
            <div className="preparedTransfer">
              <div className="privacyItem"><span><CheckCircle2 size={18} /></span><div><strong>{prepared.label || "Recipient verified"}</strong><small>{prepared.recipientFingerprint}</small></div></div>
              <button className="button primary" type="button" disabled>Proof and relay unavailable</button>
              <p className="finePrint">Transfer submission remains disabled until the browser proving worker and payment relay are connected. No funds have moved.</p>
            </div>
          )}
        </form>
        <aside className="transactionAside">
          <p className="eyebrow">Private balance</p>
          <div className="asideBalance"><span>Available to send</span><strong>{formatUsdcAtomic(wallet.balance.spendableAtomic)}</strong><small>USDC</small></div>
          <div className="asideMetric"><span>Recipient</span><strong>Encrypted output</strong></div>
          <div className="asideMetric"><span>Amount and note</span><strong>Private by default</strong></div>
          <div className="asidePrivacy"><EyeOff size={16} /><p>The chain records commitments and nullifiers, not the payment relationship.</p></div>
        </aside>
        </div>
      </div>
    </ProtectedPage>
  );
}
