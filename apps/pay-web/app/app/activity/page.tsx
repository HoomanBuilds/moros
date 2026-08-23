"use client";

import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, History, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PaymentRequestList } from "@/components/payment-request-list";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";
import { formatUsdcAtomic } from "@/lib/public-usdc";

export default function ActivityPage() {
  const wallet = usePaymentWallet();
  const requests = wallet.profile.value?.paymentRequests ?? [];
  const activities = wallet.profile.value?.paymentActivities ?? [];
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Encrypted history" title="Payment activity" description="Private transfers are discovered and decrypted on this device." />
        <div className="panelHeader">
          <div><h2>Private transaction history</h2><p>Confirmed deposits, private sends, and withdrawals from your encrypted profile.</p></div>
          <button className="button secondary compactButton" type="button" onClick={() => void wallet.refreshBalance()} disabled={wallet.balance.status === "syncing"}><RefreshCw size={16} />{wallet.balance.status === "syncing" ? "Syncing" : "Sync"}</button>
        </div>
        <div className="activitySummary">
          <div><span>Transactions</span><strong>{activities.length}</strong></div>
          <div><span>Private balance</span><strong>{wallet.balance.status === "ready" ? "Synced" : "Unavailable"}</strong></div>
          <div><span>Recovery</span><strong>{wallet.recoverySync.status === "synced" ? "Protected" : "Local"}</strong></div>
        </div>
        {activities.length > 0 ? (
          <div className="requestList">
            {activities.map((activity, index) => {
              const Icon = activity.kind === "deposit" ? ArrowDownToLine : activity.kind === "send" ? ArrowUpRight : ArrowUpFromLine;
              const title = activity.kind === "deposit" ? "Added private USDC" : activity.kind === "send" ? "Private payment sent" : "Withdrew to Stellar";
              return (
                <article className="requestRow" key={activity.transactionHash}>
                  <span className="activityIndex">{String(index + 1).padStart(3, "0")}</span>
                  <span className="requestStatusMark active" aria-hidden="true"><Icon size={16} /></span>
                  <div className="requestRowMain">
                    <div className="requestRowTitle"><strong>{title}</strong><span className="statusChip paid"><span />Confirmed</span></div>
                    <div className="requestRowMeta">
                      <span>{formatUsdcAtomic(BigInt(activity.amountAtomic))} USDC</span>
                      <span>{new Date(activity.createdAt).toLocaleString()}</span>
                      <span className="mono">{activity.recipientFingerprint || (activity.publicAccount ? `${activity.publicAccount.slice(0, 6)}...${activity.publicAccount.slice(-6)}` : `${activity.transactionHash.slice(0, 8)}...`)}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="emptyState">
            <div><History size={27} /><h2>No private transactions</h2><p className="muted">Deposit, send, or withdraw USDC to add encrypted activity.</p></div>
          </div>
        )}
        {requests.length > 0 && <><div className="panelHeader"><div><h2>Signed requests</h2><p>Active, expired, archived, and paid requests.</p></div></div><PaymentRequestList requests={requests} onCancel={(requestId) => wallet.updatePaymentRequestStatus(requestId, "cancelled")} /></>}
      </div>
    </ProtectedPage>
  );
}
