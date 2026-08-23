"use client";

import { ArrowUpFromLine, Eye, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { paymentDeployment } from "@/lib/deployment";

export default function WithdrawPage() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Public exit" title="Withdraw USDC" description="Convert private USDC into Circle USDC at any funded Stellar account." />
        <section className="panel formStack">
          <label className="field"><span>Stellar account</span><input value={recipient} onChange={(event) => setRecipient(event.target.value.trim().toUpperCase())} placeholder="G..." maxLength={56} autoComplete="off" /></label>
          <label className="field"><span>Amount</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>
          <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Private source note</strong><small>The proof spends private notes without publishing their ownership or transfer history.</small></div></div>
          <div className="privacyItem"><span><Eye size={18} /></span><div><strong>Visible destination</strong><small>The destination account and withdrawal amount become public on Stellar.</small></div></div>
          {!paymentDeployment.ready && <p className="errorText">A verified payment deployment is required before withdrawal preparation is enabled.</p>}
          <button className="button primary" type="button" disabled={!paymentDeployment.ready || !recipient || !amount}><ArrowUpFromLine size={18} />Review withdrawal</button>
        </section>
      </div>
    </ProtectedPage>
  );
}
