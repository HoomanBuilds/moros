"use client";

import { ArrowDownToLine, ArrowRight, ArrowUpRight, EyeOff, KeyRound, QrCode, ReceiptText, RotateCw, Users } from "lucide-react";
import Link from "next/link";
import { NetworkStatus } from "@/components/network-status";
import { ProtectedPage } from "@/components/protected-page";
import { UsdcIcon } from "@/components/payment-icons";
import { BalanceOverview } from "@/components/balance-overview";
import { usePaymentWallet } from "@/components/wallet-provider";
import { PaymentRequestList } from "@/components/payment-request-list";
import { formatUsdcAtomic } from "@/lib/public-usdc";

export default function HomePage() {
  const wallet = usePaymentWallet();
  const recentRequests = wallet.profile.value?.paymentRequests.slice(0, 3) ?? [];
  return (
    <ProtectedPage>
      <div className="page">
        <header className="pageHeader">
          <p className="sectionLabel"><span />Private balance</p>
          <h1>Money that moves<br /><em>off the public map.</em></h1>
          <p className="muted">A reusable Circle USDC balance for private payments on Stellar.</p>
        </header>
        <BalanceOverview />
        <div className="dashboardLead">
          <section className="vaultPanel">
            <div className="vaultPanelTop">
              <span className="assetName"><UsdcIcon /> Shielded USDC</span>
              <span className="privacyPill"><span />Encrypted balance</span>
            </div>
            <div className="vaultBalance">
              <span className="balancePrefix">$</span>
              <strong>{formatUsdcAtomic(wallet.balance.spendableAtomic)}</strong>
            </div>
            <div className="vaultPanelBottom">
              <span>Available privately</span>
              <span className="mono">7 decimal settlement</span>
            </div>
            <div className="vaultRings" aria-hidden="true"><i /><i /><i /><b /></div>
          </section>
          <aside className="commandPanel">
            <div className="commandHeader">
              <p className="eyebrow">Move privately</p>
              <NetworkStatus />
            </div>
            <Link className="commandRow" href="/app/send"><span><ArrowUpRight size={18} />Send USDC</span><ArrowRight size={17} /></Link>
            <Link className="commandRow" href="/app/request"><span><KeyRound size={18} />Request payment</span><ArrowRight size={17} /></Link>
            <Link className="commandRow" href="/app/receive"><span><QrCode size={18} />Receive code</span><ArrowRight size={17} /></Link>
            <Link className="commandRow" href="/app/contacts"><span><Users size={18} />Private contacts</span><ArrowRight size={17} /></Link>
            <Link className="commandRow" href="/app/deposit"><span><ArrowDownToLine size={18} />Add private USDC</span><ArrowRight size={17} /></Link>
          </aside>
        </div>
        <div className="protocolStrip" aria-label="Payment privacy properties">
          <div><EyeOff size={16} /><span><strong>Recipient hidden</strong><small>Encrypted outputs</small></span></div>
          <div><RotateCw size={16} /><span><strong>Balance reusable</strong><small>One private wallet</small></span></div>
          <div><KeyRound size={16} /><span><strong>Self recoverable</strong><small>24 private words</small></span></div>
        </div>
        <section className="activityPanel">
          <div className="panelHeader">
            <div><p className="eyebrow">Request book</p><h2>Recent signed requests</h2><p>Recovered from your encrypted private profile.</p></div>
            <Link className="inlineLink" href="/app/activity">Open activity <ArrowRight size={15} /></Link>
          </div>
          {recentRequests.length > 0 ? (
            <PaymentRequestList requests={recentRequests} compact />
          ) : (
            <div className="activityEmpty">
              <span className="activityIndex">000</span>
              <ReceiptText size={24} />
              <div><h3>No signed requests yet</h3><p>Create a private payment request to start your encrypted request book.</p></div>
              <Link href="/app/send">Make a payment <ArrowRight size={15} /></Link>
            </div>
          )}
        </section>
      </div>
    </ProtectedPage>
  );
}
