import { validatePaymentDeployment, type PaymentDeployment } from "@moros/payments-client";
import testnetDeployment from "../config/payments-testnet.json";

export type DeploymentState =
  | { ready: true; deployment: Readonly<PaymentDeployment> }
  | { ready: false; reason: string };

export function parsePaymentDeployment(raw: string | undefined): DeploymentState {
  if (!raw) return { ready: false, reason: "The private payment network is not configured on this build." };
  if (raw.length > 32_000) return { ready: false, reason: "The payment network configuration is too large." };
  try {
    const value = JSON.parse(raw) as PaymentDeployment;
    return { ready: true, deployment: validatePaymentDeployment(value) };
  } catch {
    return { ready: false, reason: "The private payment network configuration is invalid." };
  }
}

const configuredDeployment = process.env.NEXT_PUBLIC_PAYMENT_DEPLOYMENT?.trim();

export const paymentDeployment = parsePaymentDeployment(
  configuredDeployment || JSON.stringify(testnetDeployment),
);
