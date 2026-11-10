"use client";

import Link from "next/link";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { usePaymentWallet } from "./wallet-provider";
import { useStellarWallet } from "./stellar-wallet-provider";
import { usePaymentFlow } from "./use-payment-flow";
import { UsdcIcon } from "./payment-icons";
import { StepHeading } from "./step-heading";
import { useExpired } from "./use-expired";
import { paymentDeployment } from "@/lib/deployment";
import { preparePaymentFees, type PaymentFeeQuote } from "@/lib/payment-actions";
import { verifyDirectPaymentCode, verifyPaymentRequest, type VerifiedPaymentLink } from "@/lib/payment-identity";
import { checkPaymentBalance, checkPaymentExpiry, parsePaymentAmount } from "@/lib/payment-review";
import { formatUsdcAtomic, formatUsdcDisplay, loadPublicUsdcBalance } from "@/lib/public-usdc";
import { paymentProgressLabel } from "@/lib/payment-status";
import { bigIntFromBytes } from "@/lib/payment-protocol";
import { copyBrowserText } from "@/lib/browser-share";

type Mode = "send" | "deposit" | "withdraw";
type Review = {
  amount: bigint;
  destination: string;
  fingerprint?: string;
  label?: string;
  memo: string;
  fees?: PaymentFeeQuote;
  payloadHash?: bigint;
  requestExpiry?: number;
};

function Receipt({ hash, mode, review }: { hash: string; mode: Mode; review: Review | null }) {
  const [feedback, setFeedback] = useState("");
  return <section className="paymentReceipt panel" aria-live="polite">
    <span className="receiptCheck"><Check size={28} /></span>
    <StepHeading as="h2">{mode === "send" ? "Payment sent" : mode === "deposit" ? "USDC added" : "Withdrawal complete"}</StepHeading>
    <p className="muted">{mode === "send" ? "The recipient can now recover their USDC in Moros." : mode === "deposit" ? "Your USDC is now in your private balance." : "Your USDC has arrived at the Stellar account."}</p>
    {review && <dl className="receiptSummary"><div><dt>Amount</dt><dd>{formatUsdcDisplay(review.amount)} USDC</dd></div><div><dt>{mode === "deposit" ? "From" : "To"}</dt><dd className="breakCode">{review.label || review.fingerprint || review.destination}</dd></div></dl>}
    <details><summary>Transaction details</summary><p className="codeBlock">{hash}</p><button className="textButton" onClick={() => { void copyBrowserText(hash).then(() => setFeedback("Transaction ID copied.")).catch(() => setFeedback("Copy failed. Select the transaction ID above.")); }}><Copy size={14} />Copy transaction ID</button></details>
    {feedback && <p role="status" className="finePrint">{feedback}</p>}
    <div className="actionRow"><Link className="button primary" href="/app">Back to overview</Link><Link className="button secondary" href="/app/activity">View activity</Link></div>
  </section>;
}

export function PaymentEditor({ mode, request }: { mode: Mode; request?: VerifiedPaymentLink }) {
  const wallet = usePaymentWallet();
  const stellar = useStellarWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState(request?.amountAtomic ? formatUsdcAtomic(BigInt(request.amountAtomic)) : "");
  const [memo, setMemo] = useState("");
  const [maxPending, setMaxPending] = useState(false);
  const flow = usePaymentFlow<Review>();
  const { edit } = flow;
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasReviewing = useRef(false);
  const incomingCode = useRef<string | null>(null);
  const requestExpired = useExpired(request?.expiresAt);
  const quoteExpired = useExpired(flow.review?.fees?.expiresAt);
  const [feeQuote, setFeeQuote] = useState<PaymentFeeQuote | null>(null);
  const available = mode === "deposit" ? stellar.balanceAtomic : wallet.balance.spendableAtomic;
  const blocked = flow.busy || maxPending || wallet.operationPending;
  const contacts = wallet.profile.value?.contacts ?? [];
  const recents = wallet.profile.value?.recentRecipients ?? [];
  const suggestions = [...contacts, ...recents.filter((item) => !contacts.some((contact) => contact.paymentCode === item.paymentCode))].slice(0, 5);
  const title = mode === "deposit" ? "deposit" : mode === "withdraw" ? "withdrawal" : "payment";

  useEffect(() => { if (request) formRef.current?.focus({ preventScroll: true }); }, [request]);

  useEffect(() => {
    if (mode !== "send" || request || flow.progress || flow.uncertain) return;
    const selectContact = () => {
      try {
        const code = decodeURIComponent(window.location.hash.slice(1));
        if (code !== incomingCode.current && (code === "" || (code.startsWith("moros_pay_") && code.length <= 320))) {
          incomingCode.current = code;
          setRecipient(code);
          edit();
        }
      } catch {}
    };
    selectContact();
    window.addEventListener("hashchange", selectContact);
    return () => window.removeEventListener("hashchange", selectContact);
  }, [mode, request, edit, flow.progress, flow.uncertain]);

  useEffect(() => {
    if (flow.error) errorRef.current?.focus();
    else if (wasReviewing.current && !flow.review) formRef.current?.querySelector<HTMLInputElement>("input:not([readonly]), textarea")?.focus();
    wasReviewing.current = Boolean(flow.review);
  }, [flow.error, flow.review]);

  async function fees(expiry?: number) {
    if (!paymentDeployment.ready) throw new Error(paymentDeployment.reason);
    if (feeQuote && feeQuote.expiresAt > Date.now() / 1000 + 10 && (!expiry || feeQuote.expiresAt <= expiry)) return feeQuote;
    const quote = await preparePaymentFees(paymentDeployment.deployment, expiry);
    setFeeQuote(quote);
    return quote;
  }

  async function fillMaximum() {
    if (available === null || blocked) return;
    setMaxPending(true);
    flow.edit();
    try {
      const quote = mode === "deposit" ? null : await fees(request?.expiresAt);
      const maximum = available - (quote ? quote.relayFee + quote.protocolFee : 0n);
      if (maximum <= 0n) throw new Error("No USDC is available after fees. Add funds first.");
      setAmount(formatUsdcAtomic(maximum));
    } catch (cause) { flow.setError(cause instanceof Error ? cause.message : "Could not get current fees."); }
    finally { setMaxPending(false); }
  }

  async function checkDestination(destination: string, atomic: bigint) {
    if (!paymentDeployment.ready) throw new Error(paymentDeployment.reason);
    if (!StrKey.isValidEd25519PublicKey(destination)) throw new Error("Enter a valid Stellar account starting with G.");
    const balance = await loadPublicUsdcBalance({ horizonUrl: paymentDeployment.deployment.horizonUrl, address: destination, issuer: paymentDeployment.deployment.usdcIssuer });
    if (!balance.accountActive) throw new Error("Activate the destination account with XLM before withdrawing.");
    if (!balance.hasTrustline) throw new Error("The recipient must add Circle USDC in their Stellar wallet first.");
    if (balance.receiveCapacityAtomic < atomic) throw new Error("The recipient's USDC trustline limit is too low for this withdrawal.");
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    void flow.prepare(async () => {
      if (!paymentDeployment.ready) throw new Error(paymentDeployment.reason);
      if (new TextEncoder().encode(memo).length > 96) throw new Error("Keep the private note within 96 bytes. Emoji can use several bytes each.");
      if (mode === "deposit") {
        if (!stellar.address || stellar.status !== "ready" || !stellar.accountActive || !stellar.hasTrustline) throw new Error("Connect a funded Stellar wallet with Circle USDC first.");
        const atomic = parsePaymentAmount(amount);
        checkPaymentBalance(atomic, available);
        return { amount: atomic, destination: stellar.address, memo: "" };
      }
      const target = recipient.trim();
      const signed = request ?? (target.includes("/pay#") ? await verifyPaymentRequest(target, paymentDeployment.deployment) : undefined);
      if (signed) checkPaymentExpiry(signed.expiresAt);
      const atomic = signed?.amountAtomic ? BigInt(signed.amountAtomic) : parsePaymentAmount(amount);
      checkPaymentBalance(atomic, available);
      const verified = mode === "send" ? signed ?? await verifyDirectPaymentCode(target, paymentDeployment.deployment) : null;
      if (mode === "withdraw") await checkDestination(target, atomic);
      const quote = await fees(signed?.expiresAt);
      checkPaymentBalance(atomic, available, quote.relayFee + quote.protocolFee);
      return { amount: atomic, destination: verified?.paymentCode ?? target, fingerprint: verified?.recipientFingerprint, label: signed?.merchantLabel, memo, fees: quote, payloadHash: signed ? bigIntFromBytes(signed.payloadHash) : undefined, requestExpiry: signed?.expiresAt };
    });
  }

  function confirm() {
    void flow.submit(async (review, progress) => {
      if (review.requestExpiry) checkPaymentExpiry(review.requestExpiry);
      if (review.fees) checkPaymentExpiry(review.fees.expiresAt);
      checkPaymentBalance(review.amount, mode === "deposit" ? stellar.balanceAtomic : wallet.balance.spendableAtomic, review.fees ? review.fees.relayFee + review.fees.protocolFee : 0n);
      setFeeQuote(null);
      if (mode === "deposit") {
        if (stellar.address !== review.destination || stellar.status !== "ready") throw new Error("Your funding wallet changed. Review the deposit again.");
        const hash = await wallet.deposit(review.destination, review.amount, progress);
        void stellar.refresh();
        return hash;
      }
      if (!review.fees) throw new Error("Review this payment to get its fees.");
      if (mode === "withdraw") {
        await checkDestination(review.destination, review.amount);
        return wallet.withdraw(review.destination, review.amount, review.fees, progress);
      }
      const hash = await wallet.transfer({ recipientCode: review.destination, recipientFingerprint: review.fingerprint!, amountAtomic: review.amount, memo: review.memo, payloadHash: review.payloadHash, fees: review.fees }, progress);
      void wallet.rememberRecipient({ paymentCode: review.destination, recipientFingerprint: review.fingerprint!, label: review.label || review.fingerprint!, updatedAt: Date.now() }).catch(() => {});
      return hash;
    });
  }

  if (flow.uncertain) return <section className="panel formStack"><StepHeading as="h2">Confirmation needs checking</StepHeading><p role="status">{flow.error}</p><p className="finePrint">A connection error does not mean the payment failed. Avoid sending it again until you have verified the result.</p><div className="actionRow"><button className="button secondary" disabled={wallet.balance.status === "syncing"} onClick={() => void wallet.refreshAll()}>Refresh balance</button><Link className="button secondary" href="/app/activity">Check activity</Link></div><p className="finePrint">Private balance: {formatUsdcDisplay(wallet.balance.spendableAtomic)} USDC</p></section>;
  if (flow.hash) return <Receipt hash={flow.hash} mode={mode} review={flow.completed} />;
  if (requestExpired && !flow.progress) return <section className="panel formStack"><StepHeading as="h2">Request expired</StepHeading><p className="muted">Ask the recipient for a new payment link.</p><Link className="button secondary" href="/app">Back to overview</Link></section>;
  return <div className="paymentWorkspace">
    <section className="panel paymentPanel">
      <ol className="flowSteps" aria-label="Payment progress"><li aria-current={!flow.review ? "step" : undefined} className={!flow.review ? "current" : ""}>1. Details</li><li aria-current={flow.review ? "step" : undefined} className={flow.review ? "current" : ""}>2. Review</li><li>3. Complete</li></ol>
      {flow.review ? <div className="formStack" aria-live="polite">
        <div className="reviewHeading"><StepHeading as="h2">Review {title}</StepHeading><p className="reviewAmount">{formatUsdcDisplay(flow.review.amount)} <span>USDC</span></p></div>
        <dl className="reviewDetails">
          <div><dt>{mode === "deposit" ? "From Stellar account" : "To"}</dt><dd>{flow.review.label && <strong>{flow.review.label}</strong>}<span className="mono breakCode">{flow.review.fingerprint ?? flow.review.destination}</span></dd></div>
          {flow.review.memo && <div><dt>Private note</dt><dd>{flow.review.memo}</dd></div>}
          <div><dt>{mode === "deposit" ? "Added to private balance" : "Recipient receives"}</dt><dd>{formatUsdcDisplay(flow.review.amount)} USDC</dd></div>
          {flow.review.fees && <><div><dt>Relay fee</dt><dd>{formatUsdcDisplay(flow.review.fees.relayFee)} USDC</dd></div><div><dt>Protocol fee</dt><dd>{formatUsdcDisplay(flow.review.fees.protocolFee)} USDC</dd></div></>}
          <div className="reviewTotal"><dt>Total USDC</dt><dd>{formatUsdcDisplay(flow.review.amount + (flow.review.fees ? flow.review.fees.relayFee + flow.review.fees.protocolFee : 0n))} USDC</dd></div>
        </dl>
        {mode === "deposit" && <p className="finePrint">Freighter will show the Stellar network fee in XLM before you approve.</p>}
        {flow.review.fees && <p className="finePrint" role={quoteExpired && !flow.progress ? "status" : undefined}>{quoteExpired && !flow.progress ? "This fee quote expired. Edit details to get a new quote." : `Fee quote valid until ${new Date(flow.review.fees.expiresAt * 1000).toLocaleTimeString()}.`}</p>}
        <div className="actionRow"><button className="button secondary" disabled={blocked} onClick={flow.edit}>Edit details</button><button className="button primary" disabled={blocked || quoteExpired} onClick={confirm}>{flow.progress ? <><LoaderCircle className="spin" size={16} />{paymentProgressLabel(flow.progress)}</> : `Confirm ${title}`}</button></div>
        {flow.progress && <p className="finePrint" role="status">Keep this tab open while your payment completes.</p>}
      </div> : <form ref={formRef} tabIndex={-1} aria-label={`${title} details`} className="formStack" onSubmit={prepare}>
        <fieldset disabled={blocked} className="formFields">
          {mode === "deposit" && <div className="fundingWallet"><div><span className="muted">Funding wallet</span><strong>{stellar.address ? `${stellar.address.slice(0, 8)}...${stellar.address.slice(-8)}` : "Connect your Stellar wallet"}</strong></div><button className="button secondary compactButton" type="button" disabled={stellar.status === "connecting" || stellar.status === "loading"} onClick={() => void (stellar.address ? stellar.refresh() : stellar.connect())}>{stellar.status === "connecting" ? "Connecting..." : stellar.status === "loading" ? "Refreshing..." : stellar.address ? "Refresh" : "Connect Freighter"}</button></div>}
          {mode === "send" && !request && <>
            <div className="field"><div className="fieldHeading"><label htmlFor="payment-recipient">Recipient</label>{suggestions.length > 0 && <select className="contactSelect" aria-label="Saved contacts" value={suggestions.some((contact) => contact.paymentCode === recipient) ? recipient : ""} onChange={(event) => { setRecipient(event.target.value); flow.edit(); }}><option value="">Saved contacts</option>{suggestions.map((contact) => <option key={contact.paymentCode} value={contact.paymentCode}>{contact.label}</option>)}</select>}</div><textarea id="payment-recipient" aria-label="Recipient" required value={recipient} maxLength={4096} rows={2} placeholder="Paste a payment code or request link" onChange={(event) => { setRecipient(event.target.value); flow.edit(); }} autoComplete="off" spellCheck={false} /><small>Have a Stellar G address? <Link href="/app/withdraw">Withdraw to it instead.</Link></small></div>
          </>}
          {mode === "withdraw" && <label className="field"><span>Stellar account</span><input aria-label="Stellar account" required value={recipient} maxLength={56} placeholder="G..." onChange={(event) => { setRecipient(event.target.value.trim()); flow.edit(); }} autoComplete="off" spellCheck={false} /><small>Use an account you control. Exchanges that require a memo are not supported.</small>{stellar.address && <button type="button" className="textButton" onClick={() => { setRecipient(stellar.address!); flow.edit(); }}>Use connected wallet</button>}</label>}
          <div className="field"><span className="fieldHeading"><label htmlFor="payment-amount">{request?.amountAtomic ? "Requested amount" : "Amount"}</label>{!request?.amountAtomic && available !== null && <button type="button" className="textButton" onClick={() => void fillMaximum()}>Max</button>}</span><span className="amountBox"><input id="payment-amount" aria-label="USDC amount" inputMode="decimal" placeholder="0.00" value={amount} readOnly={Boolean(request?.amountAtomic)} onChange={(event) => { setAmount(event.target.value); flow.edit(); }} /><span className="amountAsset"><UsdcIcon />USDC</span></span><small>{available === null ? "Balance is not available yet." : `${formatUsdcDisplay(available)} USDC available${mode === "deposit" ? " in Freighter" : " before fees"}`}{!request && recipient.includes("/pay#") && " Fixed requests supply their own amount."}</small></div>
          {mode === "send" && <label className="field"><span>Note <small>Optional</small></span><input maxLength={96} value={memo} onChange={(event) => { setMemo(event.target.value); flow.edit(); }} placeholder="What's this payment for?" /><small>Encrypted for the recipient.</small></label>}
          {mode === "deposit" && stellar.accountActive === false && <p className="notice">Fund this Stellar account with XLM, then add Circle USDC in Freighter and refresh.</p>}
          {mode === "deposit" && stellar.accountActive && stellar.hasTrustline === false && <p className="notice">Add Circle USDC as an asset in Freighter, fund it, then refresh.</p>}
          {mode === "deposit" && stellar.error && <p className="errorText" role="alert">{stellar.error}</p>}
          <button className="button primary fullButton" disabled={available === null || !paymentDeployment.ready}>{flow.busy || maxPending ? <><LoaderCircle size={16} className="spin" />Checking details...</> : `Review ${title}`}</button>
        </fieldset>
      </form>}
      {flow.error && <p ref={errorRef} tabIndex={-1} className="errorText formError" role="alert">{flow.error}</p>}
    </section>
    {(wallet.balance.error || wallet.balance.spendableAtomic === null) && mode !== "deposit" && <div className="notice"><p>{wallet.balance.error || "Checking your private balance..."}</p><button className="textButton" disabled={wallet.balance.status === "syncing"} onClick={() => void wallet.refreshBalance()}>Refresh balance</button></div>}
    <details className="paymentHelp"><summary>{mode === "deposit" ? "About adding USDC" : mode === "withdraw" ? "About withdrawals" : "How this payment works"}</summary>
      <p>{mode === "deposit" ? "Freighter approves the deposit into your private balance. The source account and amount are visible on Stellar." : mode === "withdraw" ? "USDC arrives at a Stellar account with a Circle USDC trustline. The destination and amount are visible on Stellar." : "The recipient receives private USDC in Moros. They can send it again or withdraw to a Stellar account."}</p>
    </details>
  </div>;
}
