"use client";

import { ArrowDownToLine, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { paymentDeployment } from "@/lib/deployment";
import { useStellarWallet } from "@/components/stellar-wallet-provider";
import { formatUsdcAtomic } from "@/lib/public-usdc";

export default function DepositPage() {
  const [amount, setAmount] = useState("");
  const wallet = useStellarWallet();
  const busy = wallet.status === "connecting" || wallet.status === "loading";
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Public entry" title="Add private USDC" description="Move Circle USDC from a Stellar wallet into your reusable Moros balance." />
        <section className="panel formStack">
          <div className="walletBoundaryCard">
            <div><span>Public wallet</span><strong>{wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-6)}` : "Not connected"}</strong></div>
            <div><span>Circle USDC</span><strong>{formatUsdcAtomic(wallet.balanceAtomic)}</strong></div>
            {!wallet.address ? (
              <button className="button secondary" type="button" onClick={() => void wallet.connect()} disabled={!paymentDeployment.ready || busy}>Connect Stellar wallet</button>
            ) : (
              <button className="button secondary" type="button" onClick={() => void wallet.refresh()} disabled={busy}>Refresh balance</button>
            )}
          </div>
          {wallet.error && <p className="errorText" role="alert">{wallet.error}</p>}
          <div className="privacyItem"><span><ExternalLink size={18} /></span><div><strong>Stellar wallet boundary</strong><small>The source wallet and deposit amount are visible when USDC enters the vault.</small></div></div>
          <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Private after deposit</strong><small>Future transfers, recipients, note ownership, and internal balances stay protected.</small></div></div>
          <label className="field"><span>Amount</span><span className="amountBox"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /><span className="amountAsset"><UsdcIcon />USDC</span></span></label>
          {!paymentDeployment.ready && <p className="errorText">A verified payment deployment is required before wallet connection is enabled.</p>}
          <button className="button primary" type="button" disabled={!paymentDeployment.ready || !wallet.address || wallet.status !== "ready" || wallet.accountActive !== true || wallet.hasTrustline !== true || !amount}><ArrowDownToLine size={18} />Review deposit</button>
          <p className="finePrint">The app will show the exact amount, network fee, and resulting private balance before requesting a wallet signature.</p>
        </section>
      </div>
    </ProtectedPage>
  );
}
