"use client";

import { FormEvent, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { paymentDeployment } from "@/lib/deployment";

export default function SendPage() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); }
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Private transfer" title="Send USDC" description="Pay a Moros identity without publishing the recipient or amount." />
        <form className="panel formStack" onSubmit={submit}>
          <label className="field"><span>Moros payment code</span><textarea rows={4} value={recipient} onChange={(event) => setRecipient(event.target.value.trim())} placeholder="moros_pay_..." autoComplete="off" required /></label>
          <label className="field"><span>Amount</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-label="USDC amount" /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>
          <label className="field"><span>Private note, optional</span><input value={memo} maxLength={240} onChange={(event) => setMemo(event.target.value)} placeholder="Only the recipient can read this" /></label>
          <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Encrypted for the recipient</strong><small>The transfer and note are prepared locally before proof generation.</small></div></div>
          {!paymentDeployment.ready && <p className="errorText">Connect a verified payment deployment before preparing a transfer.</p>}
          <button className="button primary" disabled={!paymentDeployment.ready || !recipient || !amount}>Review private transfer</button>
        </form>
      </div>
    </ProtectedPage>
  );
}
