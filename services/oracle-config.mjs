const CEX_ASSETS = [
  "BTC",
  "ETH",
  "USDT",
  "XRP",
  "SOL",
  "USDC",
  "ADA",
  "AVAX",
  "DOT",
  "MATIC",
  "LINK",
  "DAI",
  "ATOM",
  "XLM",
  "UNI",
  "EURC",
];

const REFLECTOR_NETWORKS = {
  testnet: {
    cexOracle:
      "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63",
    fiatOracle:
      "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W",
    cexAssets: CEX_ASSETS,
    fiatAssets: [
      "EUR",
      "GBP",
      "CHF",
      "CAD",
      "MXN",
      "ARS",
      "BRL",
      "THB",
      "XAU",
    ],
  },
  mainnet: {
    cexOracle:
      "CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN",
    fiatOracle:
      "CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC",
    cexAssets: CEX_ASSETS,
    fiatAssets: [
      "EUR",
      "GBP",
      "CAD",
      "BRL",
      "JPY",
      "CNY",
      "MXN",
      "KRW",
      "TRY",
      "ARS",
      "PEN",
      "VES",
      "CLP",
      "CRC",
      "CDF",
      "COP",
      "HKD",
      "INR",
      "NGN",
      "PHP",
      "RUB",
      "ZAR",
      "XAU",
      "KES",
    ],
  },
};

export function reflectorConfig(network = "testnet") {
  const config = REFLECTOR_NETWORKS[network];
  if (!config) {
    throw new Error("oracle network must be testnet or mainnet");
  }
  return {
    ...config,
    cexAssets: [...config.cexAssets],
    fiatAssets: [...config.fiatAssets],
    freeAssets: [...config.cexAssets, ...config.fiatAssets],
  };
}

const testnetReflector = reflectorConfig("testnet");
export const REFLECTOR_CEX_ORACLE = testnetReflector.cexOracle;
export const REFLECTOR_FIAT_ORACLE = testnetReflector.fiatOracle;
export const REFLECTOR_CEX_ASSETS = testnetReflector.cexAssets;
export const REFLECTOR_FIAT_ASSETS = testnetReflector.fiatAssets;
export const FREE_REFLECTOR_ASSETS = testnetReflector.freeAssets;

export function reflectorRiskGroups(network = "testnet") {
  const config = reflectorConfig(network);
  return config.freeAssets.map((asset) => ({
    asset,
    risk_group:
      asset === "XAU"
        ? "METALS"
        : config.fiatAssets.includes(asset)
          ? "FX"
          : "CRYPTO",
  }));
}

export const FREE_REFLECTOR_RISK_GROUPS = reflectorRiskGroups("testnet");

export function reflectorResolverRoutes(resolver, network = "testnet") {
  if (!/^C[A-Z2-7]{55}$/.test(resolver || "")) {
    throw new Error("resolver contract ID is invalid");
  }
  return reflectorRiskGroups(network).map(({ asset, risk_group }) => ({
    asset,
    resolver,
    risk_group,
    registration_required: false,
  }));
}

export const PYTH_PRO_FEEDS = {
  BTC: 1,
  ETH: 2,
  SOL: 6,
  USDC: 7,
  USDT: 8,
  XRP: 14,
  ADA: 16,
  AVAX: 18,
  LINK: 19,
  DOT: 22,
  XLM: 23,
  UNI: 25,
  ATOM: 44,
  DAI: 202,
  EURC: 240,
  EUR: 327,
  GBP: 333,
  XAU: 346,
};

export function selectFreeResolver(deployment) {
  const resolver = deployment?.contracts?.resolver;
  if (!/^C[A-Z2-7]{55}$/.test(resolver || "")) {
    throw new Error("free resolver contract ID is invalid");
  }
  return resolver;
}

export function resolvableAssets(oracleMode, network = "testnet") {
  return new Set(
    oracleMode === "pyth_pro"
      ? Object.keys(PYTH_PRO_FEEDS)
      : reflectorConfig(network).freeAssets,
  );
}

export function resolutionPhase(now, expiry, finalizeAfter, resolutionTimeout) {
  if (![now, expiry, finalizeAfter, resolutionTimeout].every(Number.isSafeInteger)) {
    throw new Error("resolution timing must use integer Unix seconds");
  }
  if (expiry < 0 || finalizeAfter < expiry || resolutionTimeout < 300) {
    throw new Error("invalid resolution timing");
  }
  if (now < expiry) return "open";
  if (now < finalizeAfter) return "final_batch";
  if (now < finalizeAfter + resolutionTimeout) return "resolve";
  return "void";
}
