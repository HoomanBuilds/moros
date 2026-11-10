"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { ProtectedPage } from "@/components/protected-page";
import { PageHeader } from "@/components/page-header";
import { ActivityList } from "@/components/activity-list";
import { usePaymentWallet } from "@/components/wallet-provider";
import type { PrivatePaymentActivityKind } from "@/lib/private-profile";

export default function ActivityPage() { return <ProtectedPage><Activity /></ProtectedPage>; }
function Activity() {
  const wallet = usePaymentWallet();
  const [filter, setFilter] = useState<PrivatePaymentActivityKind | "all">("all");
  const activities = wallet.profile.value?.paymentActivities ?? [];
  const filtered = activities.filter((item) => filter === "all" || item.kind === filter);
  const syncing = wallet.balance.status === "syncing" || wallet.recoverySync.status === "syncing" || wallet.recoverySync.status === "connecting";
  return <div className="page"><PageHeader title="Activity" /><section className="panel recordPanel"><div className="recordToolbar"><div className="filterButtons" aria-label="Filter activity">{([['all','All'],['send','Sent'],['deposit','Added'],['withdraw','Withdrawn']] as const).map(([value,label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><button className="button secondary compactButton" disabled={syncing} onClick={() => void wallet.refreshAll()}><RefreshCw size={15} className={syncing ? "spin" : ""} />{syncing ? "Syncing" : "Sync"}</button></div>{filtered.length ? <ActivityList activities={filtered} /> : <div className="emptyState"><h2>{activities.length ? "No matching payments" : "No payments yet"}</h2><p>Your completed actions appear here after confirmation.</p><Link href="/app/send" className="button secondary">Make a payment</Link></div>}</section>{wallet.recoverySync.error && <div className="syncFailure"><p className="errorText" role="alert">Could not sync your latest activity. Your saved history is still available. Try Sync again.</p><details className="paymentHelp"><summary>Error details</summary><p>{wallet.recoverySync.error}</p></details></div>}<details className="paymentHelp"><summary>About this history</summary><p>Completed actions are saved in your encrypted backup. Incoming payments update your balance, but are not yet listed as separate receipts.</p></details></div>;
}
