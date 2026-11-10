"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FlowRevision, PaymentFailedError } from "@/lib/payment-review";
import type { PaymentActionProgress } from "@/lib/payment-actions";

export function usePaymentFlow<T>() {
  const revision = useRef(new FlowRevision());
  const [review, setReview] = useState<T | null>(null);
  const [completed, setCompleted] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PaymentActionProgress | null>(null);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [hash, setHash] = useState("");
  useEffect(() => {
    const controller = revision.current;
    return () => { controller.next(); };
  }, []);

  const edit = useCallback(() => {
    if (progress || uncertain) return;
    revision.current.next();
    setReview(null);
    setError("");
    setBusy(false);
  }, [progress, uncertain]);

  async function prepare(operation: () => Promise<T>) {
    if (uncertain) return;
    const token = revision.current.next();
    setBusy(true);
    setReview(null);
    setError("");
    try {
      const value = await operation();
      if (revision.current.current(token)) setReview(value);
    } catch (cause) {
      if (revision.current.current(token)) setError(cause instanceof Error ? cause.message : "Could not prepare this payment.");
    } finally {
      if (revision.current.current(token)) setBusy(false);
    }
  }

  async function submit(operation: (value: T, progress: (stage: PaymentActionProgress) => void) => Promise<string>) {
    if (!review || !revision.current.begin()) return;
    const token = revision.current.next();
    const submissionStage = { value: "preparing" as PaymentActionProgress };
    setBusy(true);
    setProgress("preparing");
    setError("");
    try {
      const result = await operation(review, (stage) => {
        submissionStage.value = stage;
        if (revision.current.current(token)) setProgress(stage);
      });
      if (revision.current.current(token)) { setHash(result); setCompleted(review); setReview(null); }
    } catch (cause) {
      if (revision.current.current(token)) {
        const unknown = !(cause instanceof PaymentFailedError) && (submissionStage.value === "submitting" || submissionStage.value === "confirming");
        setUncertain(unknown);
        setError(unknown ? "We could not confirm the final result. The payment may have reached Stellar. Check your balance and activity before making another payment." : cause instanceof Error ? cause.message : "Could not complete this payment.");
        setReview(null);
      }
    } finally {
      revision.current.finish();
      if (revision.current.current(token)) { setBusy(false); setProgress(null); }
    }
  }

  return { review, completed, busy, progress, error, hash, uncertain, edit, prepare, submit, setError };
}
