import { MorosPaymentClient, type PaymentDeployment } from "@moros/payments-client";

type PaymentClientOptions = {
  timeoutMs?: number;
  attempts?: number;
};

function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export function createPaymentClient(
  deployment: PaymentDeployment,
  options: PaymentClientOptions = {},
): MorosPaymentClient {
  return new MorosPaymentClient({ deployment, ...options, fetchImpl: browserFetch });
}
