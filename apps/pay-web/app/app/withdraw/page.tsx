"use client";

import { ArrowUpFromLine, Eye, ShieldCheck } from "lucide-react";
import { StrKey } from "@stellar/stellar-sdk";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { paymentDeployment } from "@/lib/deployment";
import { usePaymentWallet } from "@/components/wallet-provider";
import { formatUsdcAtomic } from "@/lib/public-usdc";

export default function WithdrawPage() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const wallet = usePaymentWallet();
  async function review() {
    setError("");
    setReviewed(false);
    try {
      if (!StrKey.isValidEd25519PublicKey(recipient)) throw new Error("Enter a valid Stellar account address.");
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const atomic = BigInt(core.parse_usdc_amount(amount));
      if (wallet.balance.spendableAtomic !== null && atomic > wallet.balance.spendableAtomic) throw new Error("This withdrawal exceeds your private USDC balance.");
      setReviewed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review this withdrawal.");
    }
  }
  return (
    <ProtectedPage>
      <div className="page transactionPage">
        <PageHeader eyebrow="Public exit" title="Withdraw USDC" description="Convert private USDC into Circle USDC at any funded Stellar account." />
        <div className="transactionLayout">
        <section className="panel formStack transactionForm">
          <label className="field"><span>Stellar account</span><input value={recipient} onChange={(event) => { setRecipient(event.target.value.trim().toUpperCase()); setReviewed(false); }} placeholder="G..." maxLength={56} autoComplete="off" /></label>
          <label className="field"><span className="fieldHeading"><span>Amount</span>{wallet.balance.spendableAtomic !== null && <button className="textButton" type="button" onClick={() => { setAmount(formatUsdcAtomic(wallet.balance.spendableAtomic)); setReviewed(false); }}>Use max</button>}</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReviewed(false); }} placeholder="0.00" /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>
          <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Private source note</strong><small>The proof spends private notes without publishing their ownership or transfer history.</small></div></div>
          <div className="privacyItem"><span><Eye size={18} /></span><div><strong>Visible destination</strong><small>The destination account and withdrawal amount become public on Stellar.</small></div></div>
          {!paymentDeployment.ready && <p className="errorText">A verified payment deployment is required before withdrawal preparation is enabled.</p>}
          {error && <p className="errorText" role="alert">{error}</p>}
          {!reviewed ? <button className="button primary" type="button" onClick={() => void review()} disabled={!paymentDeployment.ready || !recipient || !amount}><ArrowUpFromLine size={18} />Review withdrawal</button> : <div className="preparedTransfer"><div className="reviewLine"><span>Private balance debit</span><strong>{amount} USDC</strong></div><div className="reviewLine"><span>Public destination</span><strong className="mono">{recipient.slice(0, 6)}...{recipient.slice(-6)}</strong></div><button className="button primary" type="button" disabled>Withdrawal proving unavailable</button></div>}
        </section>
        <aside className="transactionAside"><p className="eyebrow">Private balance</p><div className="asideBalance"><span>Available to withdraw</span><strong>{formatUsdcAtomic(wallet.balance.spendableAtomic)}</strong><small>USDC</small></div><div className="asideMetric"><span>Source history</span><strong>Remains private</strong></div><div className="asideMetric"><span>Destination</span><strong>Verified Stellar account</strong></div></aside>
        </div>
      </div>
    </ProtectedPage>
  );
}
