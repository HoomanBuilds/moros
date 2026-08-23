"use client";

import { History, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PaymentRequestList } from "@/components/payment-request-list";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";

export default function ActivityPage() {
  const wallet = usePaymentWallet();
  const requests = wallet.profile.value?.paymentRequests ?? [];
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Encrypted history" title="Payment activity" description="Private transfers are discovered and decrypted on this device." />
        <div className="panelHeader">
          <div><h2>Signed request history</h2><p>Active, expired, archived, and paid requests from your encrypted profile.</p></div>
          <button className="button secondary compactButton" type="button" onClick={() => void wallet.refreshBalance()} disabled={wallet.balance.status === "syncing"}><RefreshCw size={16} />{wallet.balance.status === "syncing" ? "Syncing" : "Sync"}</button>
        </div>
        <div className="activitySummary">
          <div><span>Requests</span><strong>{requests.length}</strong></div>
          <div><span>Private balance</span><strong>{wallet.balance.status === "ready" ? "Synced" : "Unavailable"}</strong></div>
          <div><span>Recovery</span><strong>{wallet.recoverySync.status === "synced" ? "Protected" : "Local"}</strong></div>
        </div>
        {requests.length > 0 ? (
          <PaymentRequestList requests={requests} onCancel={(requestId) => wallet.updatePaymentRequestStatus(requestId, "cancelled")} />
        ) : (
          <div className="emptyState">
            <div><History size={27} /><h2>No signed requests</h2><p className="muted">Create a private request to add it to this encrypted history.</p></div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
