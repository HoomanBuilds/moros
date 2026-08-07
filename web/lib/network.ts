export type NetworkId = "testnet" | "mainnet";

export type CollateralAsset = {
  code: string;
  issuer: string | null;
  sac: string;
  decimals: number;
  native: boolean;
};

const ASSETS: Record<NetworkId, { usdc: CollateralAsset }> = {
  testnet: {
    usdc: {
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      sac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      decimals: 7,
      native: false,
    },
  },
  mainnet: {
    usdc: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      sac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      decimals: 7,
      native: false,
    },
  },
};

const DEFAULTS = {
  testnet: {
    name: "Stellar testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    privateServiceUrl: "http://127.0.0.1:8787",
    passphrase: "Test SDF Network ; September 2015",
    explorerNetwork: "testnet",
  },
  mainnet: {
    name: "Stellar mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    privateServiceUrl: "https://moros-market.duckdns.org",
    passphrase: "Public Global Stellar Network ; September 2015",
    explorerNetwork: "public",
  },
} as const;

type PublicNetworkEnv = Record<string, string | undefined>;

const BUILD_ENV: PublicNetworkEnv = {
  NEXT_PUBLIC_STELLAR_NETWORK:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_TESTNET_STELLAR_RPC_URL:
    process.env.NEXT_PUBLIC_TESTNET_STELLAR_RPC_URL,
  NEXT_PUBLIC_MAINNET_STELLAR_RPC_URL:
    process.env.NEXT_PUBLIC_MAINNET_STELLAR_RPC_URL,
  NEXT_PUBLIC_STELLAR_RPC_URL:
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  NEXT_PUBLIC_TESTNET_STELLAR_HORIZON_URL:
    process.env.NEXT_PUBLIC_TESTNET_STELLAR_HORIZON_URL,
  NEXT_PUBLIC_MAINNET_STELLAR_HORIZON_URL:
    process.env.NEXT_PUBLIC_MAINNET_STELLAR_HORIZON_URL,
  NEXT_PUBLIC_STELLAR_HORIZON_URL:
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
  NEXT_PUBLIC_TESTNET_PRIVATE_SERVICE_URL:
    process.env.NEXT_PUBLIC_TESTNET_PRIVATE_SERVICE_URL,
  NEXT_PUBLIC_MAINNET_PRIVATE_SERVICE_URL:
    process.env.NEXT_PUBLIC_MAINNET_PRIVATE_SERVICE_URL,
  NEXT_PUBLIC_PRIVATE_SERVICE_URL:
    process.env.NEXT_PUBLIC_PRIVATE_SERVICE_URL,
  NEXT_PUBLIC_COMMITTEE_URL:
    process.env.NEXT_PUBLIC_COMMITTEE_URL,
};

export function networkConfig(env: PublicNetworkEnv = BUILD_ENV) {
  const selectedId = env.NEXT_PUBLIC_STELLAR_NETWORK || "mainnet";
  if (selectedId !== "testnet" && selectedId !== "mainnet") {
    throw new Error(
      "NEXT_PUBLIC_STELLAR_NETWORK must be testnet or mainnet",
    );
  }
  const id: NetworkId = selectedId;
  const selected = DEFAULTS[id];
  const scopedRpc = id === "testnet"
    ? env.NEXT_PUBLIC_TESTNET_STELLAR_RPC_URL
    : env.NEXT_PUBLIC_MAINNET_STELLAR_RPC_URL;
  const scopedHorizon = id === "testnet"
    ? env.NEXT_PUBLIC_TESTNET_STELLAR_HORIZON_URL
    : env.NEXT_PUBLIC_MAINNET_STELLAR_HORIZON_URL;
  const scopedPrivateService = id === "testnet"
    ? env.NEXT_PUBLIC_TESTNET_PRIVATE_SERVICE_URL
    : env.NEXT_PUBLIC_MAINNET_PRIVATE_SERVICE_URL;
  return {
    id,
    name: selected.name,
    rpcUrl:
      scopedRpc ||
      (id === "testnet"
        ? env.NEXT_PUBLIC_STELLAR_RPC_URL
        : "") ||
      selected.rpcUrl,
    horizonUrl:
      scopedHorizon ||
      (id === "testnet"
        ? env.NEXT_PUBLIC_STELLAR_HORIZON_URL
        : "") ||
      selected.horizonUrl,
    privateServiceUrl:
      scopedPrivateService ||
      (id === "testnet"
        ? env.NEXT_PUBLIC_PRIVATE_SERVICE_URL ||
          env.NEXT_PUBLIC_COMMITTEE_URL
        : "") ||
      selected.privateServiceUrl,
    passphrase: selected.passphrase,
    collateral: ASSETS[id].usdc,
    explorer: (contractId: string) =>
      `https://stellar.expert/explorer/${selected.explorerNetwork}/contract/${contractId}`,
    transactionExplorer: (hash: string) =>
      `https://stellar.expert/explorer/${selected.explorerNetwork}/tx/${hash}`,
  };
}

export const NETWORK = networkConfig();

export function collateralFromRecord(record?: {
  collateralCode?: string | null;
  collateralIssuer?: string | null;
  collateralSac?: string | null;
  collateralDecimals?: number | null;
}): CollateralAsset | null {
  if (!record?.collateralCode || !record.collateralSac) return null;
  const code = record.collateralCode.toUpperCase();
  if (code === NETWORK.collateral.code && record.collateralSac === NETWORK.collateral.sac) {
    return NETWORK.collateral;
  }
  return null;
}
