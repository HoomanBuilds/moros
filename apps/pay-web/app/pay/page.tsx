"use client";

import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { usePaymentWallet } from "@/components/wallet-provider";
import { paymentDeployment } from "@/lib/deployment";
import { verifyPaymentRequest, type VerifiedPaymentLink } from "@/lib/payment-identity";
import { formatUsdcAtomic } from "@/lib/public-usdc";
import { productUrls } from "@/lib/product-urls";
import { bigIntFromBytes } from "@/lib/payment-protocol";
import { paymentProgressLabel } from "@/lib/payment-status";
import type { PaymentActionProgress } from "@/lib/payment-actions";

type RequestState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; request: VerifiedPaymentLink };

export default function PayPage() {
  return <ProtectedPage><PaymentRequestPage /></ProtectedPage>;
}

function PaymentRequestPage() {
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
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      try {
        const request = await verifyPaymentRequest(`${productUrls.pay}/pay#${payload}`, paymentDeployment.deployment);
        if (active) setState({ status: "ready", request });
      } catch {
        if (active) setState({ status: "error", message: "This request is invalid, expired, or belongs to another Moros network." });
      }
    }
    void verify();
    return () => { active = false; };
  }, []);

  return (
    <div className="page transactionPage">
      <header className="pageHeader"><p className="eyebrow">Payment request</p><h1>Review before paying</h1><p className="muted">Moros verifies the request signature, network, asset, and expiration locally.</p></header>
      {state.status === "loading" && <div className="emptyState"><div><div className="loadingMark" /><h2>Verifying request</h2></div></div>}
      {state.status === "error" && <div className="notice"><strong><AlertTriangle size={16} /> Request cannot be trusted</strong><p>{state.message}</p></div>}
      {state.status === "ready" && <VerifiedRequest request={state.request} />}
    </div>
  );
}

function VerifiedRequest({ request }: { request: VerifiedPaymentLink }) {
  const wallet = usePaymentWallet();
  const [displayAmount, setDisplayAmount] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<PaymentActionProgress | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  useEffect(() => {
    if (!request.amountAtomic) return;
    import("@moros/payments-crypto-web").then(async (core) => {
      await core.default();
      const formatted = core.format_usdc_amount(request.amountAtomic as string);
      setDisplayAmount(formatted);
      setAmount(formatted);
    });
  }, [request.amountAtomic]);
  async function review() {
    setError("");
    setReviewed(false);
    try {
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const atomic = request.amountAtomic ?? core.parse_usdc_amount(amount);
      if (wallet.balance.spendableAtomic !== null && BigInt(atomic) > wallet.balance.spendableAtomic) {
        throw new Error("This request exceeds your available private USDC.");
      }
      setReviewed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review this private payment.");
    }
  }
  async function submit() {
    setError("");
    setTransactionHash("");
    try {
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const amountAtomic = BigInt(request.amountAtomic ?? core.parse_usdc_amount(amount));
      const hash = await wallet.transfer({
        recipientCode: request.paymentCode,
        recipientFingerprint: request.recipientFingerprint,
        amountAtomic,
        memo: request.merchantLabel ? `Payment to ${request.merchantLabel}` : "Moros payment request",
        payloadHash: bigIntFromBytes(request.payloadHash),
      }, setProgress);
      setTransactionHash(hash);
      setReviewed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit this private payment.");
    } finally {
      setProgress(null);
    }
  }
  return (
    <div className="transactionLayout">
    <section className="panel formStack transactionForm">
      <div className="privacyItem"><span><CheckCircle2 size={19} /></span><div><strong>Signature verified</strong><small>The recipient and request details were not modified.</small></div></div>
      <label className="field"><span className="fieldHeading"><span>{request.amountAtomic ? "Requested amount" : "Choose amount"}</span>{!request.amountAtomic && wallet.balance.spendableAtomic !== null && <button className="textButton" type="button" onClick={() => { setAmount(formatUsdcAtomic(wallet.balance.spendableAtomic)); setReviewed(false); }}>Use max</button>}</span><span className="amountBox"><input inputMode="decimal" value={request.amountAtomic ? displayAmount ?? "" : amount} onChange={(event) => { setAmount(event.target.value); setReviewed(false); }} placeholder={request.amountAtomic ? "Loading" : "0.00"} readOnly={Boolean(request.amountAtomic)} /><span className="amountAsset"><UsdcIcon size={17} />USDC</span></span></label>
      {request.merchantLabel && <div><p className="eyebrow">Requested by</p><p>{request.merchantLabel}</p></div>}
      <div className="recipientPreview"><p className="eyebrow">Recipient fingerprint</p><p className="fingerprint">{request.recipientFingerprint}</p></div>
      <div className="privacyItem"><span><Clock3 size={18} /></span><div><strong>Expires {new Date(request.expiresAt * 1000).toLocaleString()}</strong><small>Expired requests cannot be submitted.</small></div></div>
      <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Private payment</strong><small>The recipient and amount are encrypted inside the Moros payment flow.</small></div></div>
      {error && <p className="errorText" role="alert">{error}</p>}
      {!reviewed ? <button className="button primary" type="button" onClick={() => void review()} disabled={!amount}>Review private payment</button> : <div className="preparedTransfer"><div className="reviewLine"><span>Recipient</span><strong>{request.recipientFingerprint}</strong></div><div className="reviewLine"><span>Private amount</span><strong>{amount} USDC</strong></div><button className="button primary" type="button" onClick={() => void submit()} disabled={progress !== null}>{progress ? paymentProgressLabel(progress) : "Pay privately"}</button></div>}
      {transactionHash && <p className="successText" role="status">Payment confirmed. Transaction {transactionHash.slice(0, 8)}...{transactionHash.slice(-8)}</p>}
      <p className="finePrint">The browser verifies the request and generates the payment proof locally.</p>
    </section>
    <aside className="transactionAside"><p className="eyebrow">Verified request</p><div className="asideBalance"><span>Available privately</span><strong>{formatUsdcAtomic(wallet.balance.spendableAtomic)}</strong><small>USDC</small></div><div className="asideMetric"><span>Signature</span><strong>Verified locally</strong></div><div className="asideMetric"><span>Expiry</span><strong>{new Date(request.expiresAt * 1000).toLocaleDateString()}</strong></div><p className="finePrint">The request controls its recipient, asset, amount, and expiration without exposing a public Stellar address.</p></aside>
    </div>
  );
}
