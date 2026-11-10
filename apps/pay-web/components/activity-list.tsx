"use client";
import { ArrowDownLeft, ArrowUpRight, ArrowUpFromLine, ChevronDown } from "lucide-react";
import type { PrivatePaymentActivity } from "@/lib/private-profile";
import { formatUsdcDisplay } from "@/lib/public-usdc";
const labels = { deposit: "Added USDC", send: "Sent USDC", withdraw: "Withdrew USDC" };
const icons = { deposit: ArrowDownLeft, send: ArrowUpRight, withdraw: ArrowUpFromLine };
export function ActivityList({ activities }: { activities: PrivatePaymentActivity[] }) {
  return <div className="activityRecords">{activities.map((item) => {
    const Icon = icons[item.kind];
    return <details className="activityRecord" key={item.transactionHash}><summary><span className="recordIcon"><Icon size={18} /></span><span className="recordMain"><strong>{labels[item.kind]}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="recordAmount"><strong>{item.kind === "deposit" ? "+" : "-"}{formatUsdcDisplay(BigInt(item.amountAtomic))} USDC</strong><small>Confirmed</small></span><ChevronDown className="recordChevron" size={16} aria-hidden="true" /></summary><dl className="recordDetails">{(item.publicAccount || item.recipientFingerprint) && <><dt>{item.kind === "deposit" ? "From Stellar account" : "Recipient"}</dt><dd className="mono breakCode">{item.publicAccount || item.recipientFingerprint}</dd></>}<dt>Transaction ID</dt><dd className="mono breakCode">{item.transactionHash}</dd></dl></details>;
  })}</div>;
}
