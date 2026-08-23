"use client";

import { Ban, Check, Copy, Link2, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { copyBrowserText, shareBrowserText } from "@/lib/browser-share";
import type { PrivatePaymentRequest } from "@/lib/private-profile";
import { paymentRequestAmount, paymentRequestDisplayStatus } from "@/lib/payment-request";

interface PaymentRequestListProps {
  requests: PrivatePaymentRequest[];
  compact?: boolean;
  onCancel?(requestId: string): Promise<void>;
}

const STATUS_LABELS = {
  active: "Awaiting payment",
  expired: "Expired",
  cancelled: "Archived locally",
  paid: "Paid",
};

export function PaymentRequestList({ requests, compact = false, onCancel }: PaymentRequestListProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [copiedId, setCopiedId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function copy(request: PrivatePaymentRequest) {
    setFeedback("");
    try {
      await copyBrowserText(request.paymentLink);
      setCopiedId(request.requestId);
      window.setTimeout(() => setCopiedId((current) => current === request.requestId ? "" : current), 1_500);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Could not copy this request.");
    }
  }

  async function share(request: PrivatePaymentRequest) {
    setFeedback("");
    try {
      const result = await shareBrowserText({ title: request.label || "Moros payment request", url: request.paymentLink });
      if (result === "copied") {
        setCopiedId(request.requestId);
        window.setTimeout(() => setCopiedId((current) => current === request.requestId ? "" : current), 1_500);
      }
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Could not share this request.");
    }
  }

  async function archive(requestId: string) {
    if (!onCancel) return;
    setBusyId(requestId);
    try {
      await onCancel(requestId);
      setConfirmId("");
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Could not archive this request.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className={compact ? "requestList compact" : "requestList"}>
      {requests.map((request, index) => {
        const status = paymentRequestDisplayStatus(request, now);
        return (
          <article className="requestRow" key={request.requestId}>
            <span className="activityIndex">{String(index + 1).padStart(3, "0")}</span>
            <span className={`requestStatusMark ${status}`} aria-hidden="true"><Link2 size={16} /></span>
            <div className="requestRowMain">
              <div className="requestRowTitle">
                <strong>{request.label || "Private USDC request"}</strong>
                <span className={`statusChip ${status}`}><span />{STATUS_LABELS[status]}</span>
              </div>
              <div className="requestRowMeta">
                <span>{paymentRequestAmount(request)}</span>
                <span>{status === "active" ? `Expires ${new Date(request.expiresAt * 1000).toLocaleString()}` : new Date(request.createdAt * 1000).toLocaleString()}</span>
                <span className="mono">{request.recipientFingerprint}</span>
              </div>
            </div>
            {!compact && (
              <div className="requestActions">
                <button className="iconButton" type="button" onClick={() => void copy(request)} aria-label="Copy payment request">
                  {copiedId === request.requestId ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <button className="iconButton" type="button" onClick={() => void share(request)} aria-label="Share payment request"><Share2 size={16} /></button>
                {status === "active" && onCancel && (
                  confirmId === request.requestId ? (
                    <>
                      <button className="iconButton" type="button" onClick={() => setConfirmId("")} aria-label="Keep payment request"><X size={16} /></button>
                      <button className="iconButton dangerIcon" type="button" disabled={busyId === request.requestId} onClick={() => void archive(request.requestId)} aria-label="Confirm local archive"><Check size={16} /></button>
                    </>
                  ) : (
                    <button className="iconButton dangerIcon" type="button" onClick={() => setConfirmId(request.requestId)} aria-label="Archive payment request locally"><Ban size={16} /></button>
                  )
                )}
              </div>
            )}
          </article>
        );
      })}
      {confirmId && <p className="inlineFeedback" role="status">Archiving hides this request locally. It does not revoke a link already shared.</p>}
      {feedback && <p className="errorText inlineFeedback" role="alert">{feedback}</p>}
    </div>
  );
}
