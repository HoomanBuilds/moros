"use client";

import { ArrowDownToLine, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { paymentDeployment } from "@/lib/deployment";
import { useStellarWallet } from "@/components/stellar-wallet-provider";
import { formatUsdcAtomic } from "@/lib/public-usdc";
import { usePaymentWallet } from "@/components/wallet-provider";
import { paymentProgressLabel } from "@/lib/payment-status";
import type { PaymentActionProgress } from "@/lib/payment-actions";

export default function DepositPage() {
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<PaymentActionProgress | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  const wallet = useStellarWallet();
  const privateWallet = usePaymentWallet();
  const busy = wallet.status === "connecting" || wallet.status === "loading";
  async function review() {
    setError("");
    setReviewed(false);
    try {
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const atomic = BigInt(core.parse_usdc_amount(amount));
      if (wallet.balanceAtomic !== null && atomic > wallet.balanceAtomic) throw new Error("This deposit exceeds your public USDC balance.");
      setReviewed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review this deposit.");
    }
  }
  async function submit() {
    if (!wallet.address) return;
    setError("");
    setTransactionHash("");
    try {
      const core = await import("@moros/payments-crypto-web");
      await core.default();
      const hash = await privateWallet.deposit(wallet.address, BigInt(core.parse_usdc_amount(amount)), setProgress);
      setTransactionHash(hash);
      setReviewed(false);
      setAmount("");
      await wallet.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not deposit private USDC.");
    } finally {
      setProgress(null);
    }
  }
  return (
    <ProtectedPage>
      <div className="page transactionPage">
        <PageHeader eyebrow="Public entry" title="Add private USDC" description="Move Circle USDC from a Stellar wallet into your reusable Moros balance." />
        <div className="transactionLayout">
        <section className="panel formStack transactionForm">
          <div className="walletBoundaryCard">
            <div><span>Public wallet</span><strong>{wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-6)}` : "Not connected"}</strong></div>
            <div><span>Circle USDC</span><strong>{formatUsdcAtomic(wallet.balanceAtomic)}</strong></div>
            {!wallet.address ? (
              <button className="button secondary" type="button" onClick={() => void wallet.connect()} disabled={!paymentDeployment.ready || busy}>Connect Stellar wallet</button>
            ) : (
              <button className="button secondary" type="button" onClick={() => void wallet.refresh()} disabled={busy}>Refresh balance</button>
            )}
          </div>
          {(wallet.error || error) && <p className="errorText" role="alert">{wallet.error || error}</p>}
          <div className="privacyItem"><span><ExternalLink size={18} /></span><div><strong>Stellar wallet boundary</strong><small>The source wallet and deposit amount are visible when USDC enters the vault.</small></div></div>
          <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Private after deposit</strong><small>Future transfers, recipients, note ownership, and internal balances stay protected.</small></div></div>
          <label className="field"><span className="fieldHeading"><span>Amount</span>{wallet.balanceAtomic !== null && <button className="textButton" type="button" onClick={() => { setAmount(formatUsdcAtomic(wallet.balanceAtomic)); setReviewed(false); }}>Use max</button>}</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setReviewed(false); }} placeholder="0.00" /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>
          {!paymentDeployment.ready && <p className="errorText">A verified payment deployment is required before wallet connection is enabled.</p>}
          {!reviewed ? (
            <button className="button primary" type="button" onClick={() => void review()} disabled={!paymentDeployment.ready || !wallet.address || wallet.status !== "ready" || wallet.accountActive !== true || wallet.hasTrustline !== true || !amount}><ArrowDownToLine size={18} />Review deposit</button>
          ) : (
            <div className="preparedTransfer"><div className="reviewLine"><span>From public wallet</span><strong>{amount} USDC</strong></div><div className="reviewLine"><span>Into private balance</span><strong>{amount} USDC</strong></div><button className="button primary" type="button" onClick={() => void submit()} disabled={progress !== null}>{progress ? paymentProgressLabel(progress) : "Add to private balance"}</button></div>
          )}
          {transactionHash && <p className="successText" role="status">Deposit confirmed. Transaction {transactionHash.slice(0, 8)}...{transactionHash.slice(-8)}</p>}
          <p className="finePrint">The proof is generated in this browser. Freighter asks for one approval before the deposit is submitted.</p>
        </section>
        <aside className="transactionAside"><p className="eyebrow">Entry boundary</p><div className="asideMetric"><span>Asset</span><strong>Circle USDC</strong></div><div className="asideMetric"><span>Source</span><strong>Connected Stellar wallet</strong></div><div className="asideMetric"><span>After deposit</span><strong>Reusable private notes</strong></div><p className="finePrint">One deposit can fund future payments without reconnecting the public wallet each time.</p></aside>
        </div>
      </div>
    </ProtectedPage>
  );
}
