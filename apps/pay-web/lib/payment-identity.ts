import { StrKey } from "@stellar/stellar-sdk";
import { base64UrlToBytes, bytesToBase64Url, type PaymentDeployment } from "@moros/payments-client";

let initialized: Promise<typeof import("@moros/payments-crypto-web")> | null = null;

async function cryptoCore(): Promise<typeof import("@moros/payments-crypto-web")> {
  if (!initialized) {
    initialized = import("@moros/payments-crypto-web").then(async (module) => {
      await module.default();
      return module;
    });
  }
  return initialized;
}

function networkId(deployment: Pick<PaymentDeployment, "network">): number {
  return deployment.network === "stellar:pubnet" ? 2 : 1;
}

function contractBytes(contract: string): Uint8Array {
  const bytes = StrKey.decodeContract(contract);
  if (bytes.length !== 32) throw new Error("invalid contract identifier");
  return bytes;
}

export interface PaymentIdentityView {
  paymentCode: string;
  recipientFingerprint: string;
}

export interface PaymentIdentityMaterial extends PaymentIdentityView {
  spendSecret: Uint8Array;
  viewingSecret: Uint8Array;
}

export async function createRecoveryPhrase(): Promise<string> {
  const core = await cryptoCore();
  return core.recovery_phrase_from_entropy(crypto.getRandomValues(new Uint8Array(32)));
}

export async function derivePaymentIdentity(
  phrase: string,
  deployment: PaymentDeployment,
  childIndex = 0n,
): Promise<PaymentIdentityView> {
  const core = await cryptoCore();
  const identity = core.payment_identity_from_phrase(
    phrase,
    networkId(deployment),
    contractBytes(deployment.vault),
    childIndex,
  );
  try {
    return {
      paymentCode: identity.payment_code,
      recipientFingerprint: identity.recipient_fingerprint,
    };
  } finally {
    identity.free();
  }
}

export async function derivePaymentIdentityMaterial(
  phrase: string,
  deployment: PaymentDeployment,
  childIndex = 0n,
): Promise<PaymentIdentityMaterial> {
  const core = await cryptoCore();
  const identity = core.payment_identity_from_phrase(
    phrase,
    networkId(deployment),
    contractBytes(deployment.vault),
    childIndex,
  );
  try {
    return {
      paymentCode: identity.payment_code,
      recipientFingerprint: identity.recipient_fingerprint,
      spendSecret: identity.spend_secret(),
      viewingSecret: identity.viewing_secret(),
    };
  } finally {
    identity.free();
  }
}

export async function createIncomingViewingExport(
  phrase: string,
  deployment: PaymentDeployment,
  maximumChildIndex: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumChildIndex) || maximumChildIndex < 0 || maximumChildIndex > 1_000) {
    throw new Error("The viewing export identity range is invalid.");
  }
  const core = await cryptoCore();
  return core.incoming_viewing_export_from_phrase(
    phrase,
    networkId(deployment),
    contractBytes(deployment.vault),
    BigInt(maximumChildIndex),
  );
}

export async function decryptPaymentOutput(input: {
  envelope: Uint8Array;
  viewingSecret: Uint8Array;
  paymentCode: string;
  noteDomain: Uint8Array;
  expectedCommitment: Uint8Array;
}) {
  const core = await cryptoCore();
  return core.decrypt_payment_output(
    input.envelope,
    input.viewingSecret,
    input.paymentCode,
    input.noteDomain,
    input.expectedCommitment,
  );
}

export interface PaymentRequestInput {
  phrase: string;
  deployment: PaymentDeployment;
  childIndex?: bigint;
  amountAtomic?: string;
  merchantLabel?: string;
  expiresAt: number;
  now?: number;
}

export async function createPaymentRequest(input: PaymentRequestInput): Promise<string> {
  const core = await cryptoCore();
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const identity = core.payment_identity_from_phrase(
    input.phrase,
    networkId(input.deployment),
    contractBytes(input.deployment.vault),
    input.childIndex ?? 0n,
  );
  try {
    return identity.create_payment_link(
      contractBytes(input.deployment.usdcContract),
      input.amountAtomic,
      crypto.getRandomValues(new Uint8Array(16)),
      BigInt(now),
      BigInt(input.expiresAt),
      input.merchantLabel?.trim() || undefined,
    );
  } finally {
    identity.free();
  }
}

export async function verifyDirectPaymentCode(
  encoded: string,
  deployment: PaymentDeployment,
): Promise<PaymentIdentityView> {
  const paymentCode = encoded.trim();
  const prefix = "moros_pay_";
  if (!paymentCode.startsWith(prefix) || paymentCode.length > 320) throw new Error("This is not a Moros payment code.");
  const core = await cryptoCore();
  const recipientFingerprint = core.payment_code_fingerprint(paymentCode);
  const bytes = base64UrlToBytes(paymentCode.slice(prefix.length));
  if (bytes.length !== 216) throw new Error("This Moros payment code is invalid.");
  if (bytes[1] !== networkId(deployment)) throw new Error("This payment code belongs to another Stellar network.");
  const expectedVault = contractBytes(deployment.vault);
  let vaultMatches = true;
  for (let index = 0; index < expectedVault.length; index += 1) {
    vaultMatches = vaultMatches && bytes[index + 4] === expectedVault[index];
  }
  if (!vaultMatches) throw new Error("This payment code belongs to another private vault.");
  return { paymentCode, recipientFingerprint };
}

export interface VerifiedPaymentLink {
  requestId: string;
  paymentCode: string;
  recipientFingerprint: string;
  amountAtomic?: string;
  merchantLabel?: string;
  createdAt: number;
  expiresAt: number;
}

export async function verifyPaymentRequest(
  link: string,
  deployment: PaymentDeployment,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifiedPaymentLink> {
  const core = await cryptoCore();
  const request = core.verify_payment_link(
    link,
    BigInt(now),
    300n,
    networkId(deployment),
    contractBytes(deployment.vault),
    contractBytes(deployment.usdcContract),
    "1000000000000000000000000000000",
  );
  try {
    return {
      requestId: bytesToBase64Url(request.request_id),
      paymentCode: request.payment_code,
      recipientFingerprint: request.recipient_fingerprint,
      amountAtomic: request.amount,
      merchantLabel: request.merchant_label,
      createdAt: Number(request.created_at),
      expiresAt: Number(request.expires_at),
    };
  } finally {
    request.free();
  }
}
