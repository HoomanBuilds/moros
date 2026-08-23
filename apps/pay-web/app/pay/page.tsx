"use client";

import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { UsdcIcon } from "@/components/payment-icons";
import { paymentDeployment } from "@/lib/deployment";
import { verifyPaymentRequest, type VerifiedPaymentLink } from "@/lib/payment-identity";

type RequestState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; request: VerifiedPaymentLink };

export default function PayPage() {
  const [state, setState] = useState<RequestState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    async function verify() {
      if (!paymentDeployment.ready) {
        setState({ status: "error", message: paymentDeployment.reason });
        return;
      }
      const payload = window.location.hash.slice(1);
      if (!payload || payload.length > 4096) {
        setState({ status: "error", message: "This payment request is missing or malformed." });
        return;
      }
      try {
        const request = await verifyPaymentRequest(`https://pay.moros.fun/pay#${payload}`, paymentDeployment.deployment);
        if (active) setState({ status: "ready", request });
      } catch {
        if (active) setState({ status: "error", message: "This request is invalid, expired, or belongs to another Moros network." });
      }
    }
    void verify();
    return () => { active = false; };
  }, []);

  return (
    <AppShell>
      <div className="page">
        <header className="pageHeader"><p className="eyebrow">Payment request</p><h1>Review before paying</h1><p className="muted">Moros verifies the request signature, network, asset, and expiration locally.</p></header>
        {state.status === "loading" && <div className="emptyState"><div><div className="loadingMark" /><h2>Verifying request</h2></div></div>}
        {state.status === "error" && <div className="notice"><strong><AlertTriangle size={16} /> Request cannot be trusted</strong><p>{state.message}</p></div>}
        {state.status === "ready" && <VerifiedRequest request={state.request} />}
      </div>
    </AppShell>
  );
}

function VerifiedRequest({ request }: { request: VerifiedPaymentLink }) {
  const [displayAmount, setDisplayAmount] = useState<string | null>(null);
  useEffect(() => {
    if (!request.amountAtomic) return;
    import("@moros/payments-crypto-web").then(async (core) => {
      await core.default();
      setDisplayAmount(core.format_usdc_amount(request.amountAtomic as string));
    });
  }, [request.amountAtomic]);
  return (
    <section className="panel formStack">
      <div className="privacyItem"><span><CheckCircle2 size={19} /></span><div><strong>Signature verified</strong><small>The recipient and request details were not modified.</small></div></div>
      <div>
        <p className="eyebrow">Amount</p>
        <div className="balanceValue"><strong>{request.amountAtomic ? displayAmount ?? "..." : "Open"}</strong><span><UsdcIcon size={17} /> USDC</span></div>
      </div>
      {request.merchantLabel && <div><p className="eyebrow">Requested by</p><p>{request.merchantLabel}</p></div>}
      <div className="recipientPreview"><p className="eyebrow">Recipient fingerprint</p><p className="fingerprint">{request.recipientFingerprint}</p></div>
      <div className="privacyItem"><span><Clock3 size={18} /></span><div><strong>Expires {new Date(request.expiresAt * 1000).toLocaleString()}</strong><small>Expired requests cannot be submitted.</small></div></div>
      <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Private payment</strong><small>The recipient and amount are encrypted inside the Moros payment flow.</small></div></div>
      <button className="button primary" type="button" disabled>Unlock and continue</button>
      <p className="finePrint">Payment execution becomes available after the proving and relay deployment is connected.</p>
    </section>
  );
}
