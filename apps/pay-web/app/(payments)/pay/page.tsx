"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { PaymentEditor } from "@/components/payment-editor";
import { StepHeading } from "@/components/step-heading";
import { useExpired } from "@/components/use-expired";
import { usePaymentWallet } from "@/components/wallet-provider";
import { paymentDeployment } from "@/lib/deployment";
import { verifyPaymentRequest, type VerifiedPaymentLink } from "@/lib/payment-identity";
import { formatUsdcDisplay } from "@/lib/public-usdc";
import { productUrls } from "@/lib/product-urls";

type RequestState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; request: VerifiedPaymentLink };

export default function PayPage() {
  const [state, setState] = useState<RequestState>({ status: "loading" });
  const wallet = usePaymentWallet();
  const expired = useExpired(state.status === "ready" ? state.request.expiresAt : undefined);
  useEffect(() => {
    let version = 0;
    async function verify() {
      const current = ++version;
      setState({ status: "loading" });
      try {
        if (!paymentDeployment.ready) throw new Error(paymentDeployment.reason);
        const payload = window.location.hash.slice(1);
        if (!payload || payload.length > 4096) throw new Error("This payment link is missing its signed request. Ask the sender for the full link.");
        const request = await verifyPaymentRequest(`${productUrls.pay}/pay#${payload}`, paymentDeployment.deployment);
        if (current === version) setState({ status: "ready", request });
      } catch (cause) {
        if (current === version) setState({ status: "error", message: cause instanceof Error ? cause.message : "This payment request could not be verified." });
      }
    }
    void verify();
    window.addEventListener("hashchange", verify);
    return () => { version += 1; window.removeEventListener("hashchange", verify); };
  }, []);

  return <div className="page transactionPage">
    <PageHeader title="Payment request" description="Check who you're paying before you continue." />
    {state.status === "loading" && <div className="panel emptyState" role="status"><p>Verifying the signed request...</p></div>}
    {state.status === "error" && <section className="panel formStack"><StepHeading as="h2">Request unavailable</StepHeading><p className="errorText" role="alert">{state.message}</p><Link className="button secondary" href="/app">Open your wallet</Link></section>}
    {state.status === "ready" && <>
      <div className="requestPreview"><div><span className="muted">Requested by</span><strong>{state.request.merchantLabel || state.request.recipientFingerprint}</strong><small>Expires {new Date(state.request.expiresAt * 1000).toLocaleString()}</small></div><strong>{state.request.amountAtomic ? `${formatUsdcDisplay(BigInt(state.request.amountAtomic))} USDC` : "You choose the amount"}</strong></div>
      {expired && wallet.status !== "unlocked" ? <section className="panel formStack"><StepHeading as="h2">Request expired</StepHeading><p className="muted">Ask the recipient for a new payment link.</p><Link className="button secondary" href="/app">Open your wallet</Link></section> : <ProtectedPage><PaymentEditor key={state.request.requestId} mode="send" request={state.request} /></ProtectedPage>}
    </>}
  </div>;
}
