export const REFLECTOR_CEX_ORACLE = "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63";
export const REFLECTOR_FIAT_ORACLE = "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W";

export const REFLECTOR_CEX_ASSETS = [
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

export const REFLECTOR_FIAT_ASSETS = [
  "EUR",
  "GBP",
  "CHF",
  "CAD",
  "MXN",
  "ARS",
  "BRL",
  "THB",
  "XAU",
];

export const FREE_REFLECTOR_ASSETS = [...REFLECTOR_CEX_ASSETS, ...REFLECTOR_FIAT_ASSETS];

export const FREE_REFLECTOR_RISK_GROUPS = FREE_REFLECTOR_ASSETS.map((asset) => ({
  asset,
  risk_group:
    asset === "XAU"
      ? "METALS"
      : REFLECTOR_FIAT_ASSETS.includes(asset)
        ? "FX"
        : "CRYPTO",
}));

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

export function resolvableAssets(oracleMode) {
  return new Set(oracleMode === "pyth_pro" ? Object.keys(PYTH_PRO_FEEDS) : FREE_REFLECTOR_ASSETS);
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
