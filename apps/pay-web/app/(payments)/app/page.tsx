"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import { ProtectedPage } from "@/components/protected-page";
import { PageHeader } from "@/components/page-header";
import { usePaymentWallet } from "@/components/wallet-provider";
import { PublicWalletCard } from "@/components/public-wallet-card";
import { PaymentRequestList } from "@/components/payment-request-list";
import { ActivityList } from "@/components/activity-list";
import { formatUsdcDisplay } from "@/lib/public-usdc";
import { UsdcIcon } from "@/components/payment-icons";

export default function HomePage() { return <ProtectedPage><Overview /></ProtectedPage>; }

function Overview() {
  const wallet = usePaymentWallet();
  const activities = wallet.profile.value?.paymentActivities ?? [];
  const requests = wallet.profile.value?.paymentRequests ?? [];
  return <div className="page overviewPage">
    <PageHeader title="Overview" />
    <div className="overviewBalances">
      <section className="privateBalancePanel panel">
        <div className="panelHeading"><span><UsdcIcon size={20} />Private USDC</span><button className="iconButton" aria-label="Refresh private balance" disabled={wallet.balance.status === "syncing"} onClick={() => void wallet.refreshBalance()}><RefreshCw size={16} className={wallet.balance.status === "syncing" ? "spin" : ""} /></button></div>
        <p className="balanceAmount">{formatUsdcDisplay(wallet.balance.spendableAtomic)} <small>USDC</small></p>
        <p className="muted">{wallet.balance.status === "syncing" ? "Updating your balance..." : "Available to send"}</p>
        {wallet.balance.error && <p className="errorText" role="alert">{wallet.balance.error}</p>}
        <div className="balanceActions"><Link href="/app/send" className="button primary"><ArrowUpRight size={17} />Send</Link><Link href="/app/receive" className="button secondary"><ArrowDownLeft size={17} />Receive</Link><Link href="/app/deposit" className="button secondary"><Plus size={17} />Add USDC</Link><Link href="/app/withdraw" className="textButton">Withdraw</Link></div>
      </section>
      <PublicWalletCard />
    </div>
    {wallet.recoverySync.status === "error" && <div className="recoveryNotice"><div><strong>Encrypted backup needs attention</strong><p>Your wallet is available on this device. Retry to update its backup.</p></div><button className="button secondary" onClick={() => void wallet.refreshAll()}>Retry sync</button></div>}
    <div className="overviewRecords">
    <section className="panel recordPanel"><div className="panelHeading"><h2>Recent activity</h2>{activities.length > 0 && <Link href="/app/activity" className="textButton">View all</Link>}</div>{activities.length ? <ActivityList activities={activities.slice(0, 4)} /> : <div className="compactEmpty"><div><strong>No activity yet</strong><p>Completed payments will appear here.</p></div></div>}</section>
    <section className="panel recordPanel"><div className="panelHeading"><h2>Payment requests</h2>{requests.length > 0 && <Link href="/app/request" className="textButton">Create request</Link>}</div>{requests.length ? <PaymentRequestList requests={requests.slice(0, 3)} compact /> : <div className="compactEmpty"><div><strong>Get paid with a link</strong><p>Choose an amount and share your request.</p></div><Link className="button secondary compactButton" href="/app/request">Create request</Link></div>}</section>
    </div>
  </div>;
}
