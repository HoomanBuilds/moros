export type NetworkId = "testnet" | "mainnet";

export type CollateralAsset = {
  code: string;
  issuer: string | null;
  sac: string;
  decimals: number;
  native: boolean;
};

const NETWORK_ID: NetworkId = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

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
    passphrase: "Test SDF Network ; September 2015",
    explorerNetwork: "testnet",
    marketId: "CAXGT3SHUEVWLHA7PZKPNZCVGMEWLWCZTK6EQZWQABOL4NDBEPLRCU64",
    poolId: "CADIVW7SHMAFKTVU2P7IZ6UONFJWDXNQJFB4RRBE7KZFGXVSXWJEPKKP",
  },
  mainnet: {
    name: "Stellar mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
    explorerNetwork: "public",
    marketId: "",
    poolId: "",
  },
} as const;

const selected = DEFAULTS[NETWORK_ID];

export const NETWORK = {
  id: NETWORK_ID,
  name: selected.name,
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL || selected.rpcUrl,
  horizonUrl: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL || selected.horizonUrl,
  passphrase: selected.passphrase,
  marketId: process.env.NEXT_PUBLIC_SEED_MARKET_ID || selected.marketId,
  poolId: process.env.NEXT_PUBLIC_SEED_POOL_ID || selected.poolId,
  collateral: ASSETS[NETWORK_ID].usdc,
  explorer: (id: string) => `https://stellar.expert/explorer/${selected.explorerNetwork}/contract/${id}`,
  transactionExplorer: (hash: string) => `https://stellar.expert/explorer/${selected.explorerNetwork}/tx/${hash}`,
};

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
