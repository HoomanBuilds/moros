const ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/;
const PROJECT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const STELLAR_SIGN_XDR_METHOD = "stellar_signXDR";

export type WalletConnectSession = {
  topic: string;
  expiry: number;
  namespaces: Record<string, {
    accounts: string[];
    methods: string[];
    events: string[];
    chains?: string[];
  }>;
  peer: {
    metadata: {
      name: string;
    };
  };
};

export function parseWalletConnectProjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return PROJECT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function stellarWalletConnectChain(environment: string, network: string): string | null {
  const normalizedEnvironment = environment.trim().toLowerCase();
  const normalizedNetwork = network.trim().toLowerCase();
  if (normalizedEnvironment === "mainnet" || normalizedNetwork === "mainnet" || normalizedNetwork === "stellar:pubnet") {
    return "stellar:pubnet";
  }
  if (normalizedEnvironment === "testnet" || normalizedNetwork === "testnet" || normalizedNetwork === "stellar:testnet") {
    return "stellar:testnet";
  }
  return null;
}

export function walletConnectSessionAddress(session: WalletConnectSession, chain: string): string | null {
  const namespace = session.namespaces.stellar;
  if (!namespace || !namespace.methods.includes(STELLAR_SIGN_XDR_METHOD)) return null;
  for (const account of namespace.accounts) {
    const parts = account.split(":");
    if (parts.length === 3 && `${parts[0]}:${parts[1]}` === chain && ACCOUNT_PATTERN.test(parts[2])) {
      return parts[2];
    }
  }
  return null;
}

export function selectWalletConnectSession(
  sessions: WalletConnectSession[],
  chain: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): WalletConnectSession | null {
  return sessions
    .filter((session) => session.expiry > nowSeconds && walletConnectSessionAddress(session, chain))
    .sort((left, right) => right.expiry - left.expiry)[0] ?? null;
}

export function walletConnectAccountFromEvent(value: unknown, chain: string): string | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (ACCOUNT_PATTERN.test(candidate)) return candidate;
    const parts = candidate.split(":");
    if (parts.length === 3 && `${parts[0]}:${parts[1]}` === chain && ACCOUNT_PATTERN.test(parts[2])) {
      return parts[2];
    }
  }
  return null;
}

export function signedXdrFromWalletConnect(value: unknown): string {
  if (!value || typeof value !== "object" || !("signedXDR" in value)) {
    throw new Error("The Stellar wallet returned an invalid signature response.");
  }
  const signedXdr = value.signedXDR;
  if (typeof signedXdr !== "string" || signedXdr.length < 16 || signedXdr.length > 1_000_000) {
    throw new Error("The Stellar wallet returned an invalid signed transaction.");
  }
  return signedXdr;
}

export function pairingTopicFromUri(uri: string): string | null {
  const match = /^wc:([0-9a-f]{64})@2\?/u.exec(uri);
  return match?.[1] ?? null;
}

export function freighterPairingUrl(uri: string): string {
  if (!pairingTopicFromUri(uri)) throw new Error("The WalletConnect pairing code is invalid.");
  return `freighterwallet://wc?uri=${encodeURIComponent(uri)}`;
}
