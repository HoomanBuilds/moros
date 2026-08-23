import Constants from "expo-constants";

type DeploymentState =
  | { ready: true; environment: string; network: string; vault: string; horizonUrl: string; usdcIssuer: string }
  | { ready: false; reason: string };

function isContractId(value: unknown): value is string {
  return typeof value === "string" && /^C[A-Z2-7]{55}$/.test(value);
}

function isAccountId(value: unknown): value is string {
  return typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value);
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash ? parsed.href.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export function readPaymentDeployment(): DeploymentState {
  const raw = Constants.expoConfig?.extra?.paymentDeployment;
  if (typeof raw !== "string" || !raw.trim()) {
    return { ready: false, reason: "Payment network setup required" };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const horizonUrl = httpsUrl(parsed.horizonUrl);
    if (typeof parsed.environment !== "string" || typeof parsed.network !== "string" || !isContractId(parsed.vault) || !horizonUrl || !isAccountId(parsed.usdcIssuer)) {
      return { ready: false, reason: "Payment deployment is invalid" };
    }
    return { ready: true, environment: parsed.environment, network: parsed.network, vault: parsed.vault, horizonUrl, usdcIssuer: parsed.usdcIssuer };
  } catch {
    return { ready: false, reason: "Payment deployment is invalid" };
  }
}

export const paymentDeployment = readPaymentDeployment();
