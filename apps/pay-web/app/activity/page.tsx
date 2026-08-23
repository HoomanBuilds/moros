import { History, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";

export default function ActivityPage() {
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Encrypted history" title="Payment activity" description="Private transfers are discovered and decrypted on this device." />
        <div className="panelHeader">
          <div><h2>All activity</h2><p>Sent, received, pending, and withdrawn.</p></div>
          <button className="button secondary" type="button" disabled><RefreshCw size={16} />Sync</button>
        </div>
        <div className="emptyState">
          <div><History size={27} /><h2>No payment activity</h2><p className="muted">Encrypted receipts and recoverable operation states will appear after the payment network is connected.</p></div>
        </div>
      </div>
    </ProtectedPage>
  );
}
