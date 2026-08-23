import type { PaymentActionProgress } from "./payment-actions";

export function paymentProgressLabel(progress: PaymentActionProgress | null): string {
  if (progress === "preparing") return "Preparing private notes...";
  if (progress === "proving") return "Generating proof in this browser...";
  if (progress === "approving") return "Approve in Freighter...";
  if (progress === "submitting") return "Submitting to Stellar...";
  if (progress === "confirming") return "Confirming on Stellar...";
  return "Submit";
}
