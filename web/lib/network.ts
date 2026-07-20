export type NetworkId = "testnet" | "mainnet";

export type CollateralAsset = {
  code: string;
  issuer: string | null;
  sac: string;
  decimals: number;
  native: boolean;
};

const NETWORK_ID: NetworkId = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

const ASSETS: Record<NetworkId, { usdc: CollateralAsset; xlm: CollateralAsset }> = {
  testnet: {
    usdc: {
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      sac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      decimals: 7,
      native: false,
    },
    xlm: {
      code: "XLM",
      issuer: null,
      sac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      decimals: 7,
      native: true,
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
    xlm: {
      code: "XLM",
      issuer: null,
      sac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
      decimals: 7,
      native: true,
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
    marketId: "CBCFLHWJY37QIFFLGA5KQVTPXZQW5MD32EKHL5A6A5HSYFHOKJHRGG4N",
    poolId: "CAJFPQUSDRICY627OZU2FVNQVAIL653CAAWVEE4VBDWLZIUMO5H33UAZ",
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
  legacyCollateral: ASSETS[NETWORK_ID].xlm,
  explorer: (id: string) => `https://stellar.expert/explorer/${selected.explorerNetwork}/contract/${id}`,
  transactionExplorer: (hash: string) => `https://stellar.expert/explorer/${selected.explorerNetwork}/tx/${hash}`,
};

export function collateralFromRecord(record?: {
  collateralCode?: string | null;
  collateralIssuer?: string | null;
  collateralSac?: string | null;
  collateralDecimals?: number | null;
}): CollateralAsset {
  if (!record?.collateralCode || !record.collateralSac) return NETWORK.legacyCollateral;
  const code = record.collateralCode.toUpperCase();
  if (code === NETWORK.collateral.code && record.collateralSac === NETWORK.collateral.sac) {
    return NETWORK.collateral;
  }
  if (code === NETWORK.legacyCollateral.code && record.collateralSac === NETWORK.legacyCollateral.sac) {
    return NETWORK.legacyCollateral;
  }
  return NETWORK.legacyCollateral;
}
