export const CRYPTO_PRICE_ASSETS = [
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
] as const;

export const FX_PRICE_ASSETS = ["EUR", "GBP", "CHF", "CAD", "MXN", "ARS", "BRL", "THB"] as const;
export const GOLD_PRICE_ASSETS = ["XAU"] as const;

export const PRICE_CATEGORY_ASSETS = {
  "Crypto price": CRYPTO_PRICE_ASSETS,
  FX: FX_PRICE_ASSETS,
  "Gold price": GOLD_PRICE_ASSETS,
} as const;

export type PriceCategory = keyof typeof PRICE_CATEGORY_ASSETS;

export const EVENT_CATEGORIES = [
  "Equities",
  "Commodities",
  "Sports",
  "Economics",
  "Weather",
  "Politics",
  "Technology",
  "Entertainment",
  "Other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type MarketCategory = PriceCategory | EventCategory;

export const MARKET_CATEGORIES: readonly MarketCategory[] = [
  "Crypto price",
  "FX",
  "Gold price",
  ...EVENT_CATEGORIES,
];

export const FREE_RESOLVABLE_ASSETS = [
  ...CRYPTO_PRICE_ASSETS,
  ...FX_PRICE_ASSETS,
  ...GOLD_PRICE_ASSETS,
];

export const PYTH_PRO_RESOLVABLE_ASSETS = [
  "BTC",
  "ETH",
  "USDT",
  "XRP",
  "SOL",
  "USDC",
  "ADA",
  "AVAX",
  "DOT",
  "LINK",
  "DAI",
  "ATOM",
  "XLM",
  "UNI",
  "EURC",
  "EUR",
  "GBP",
  "XAU",
] as const;

export const EVENT_SOURCE_GUIDANCE: Record<EventCategory, {
  question: string;
  source: string;
  sourceHint: string;
  rules: string;
  voidRules: string;
}> = {
  Equities: {
    question: "Will the named stock close at or above the stated price on the stated session?",
    source: "https://official-exchange.example/market-data",
    sourceHint: "Use the official exchange, issuer filing, or regulator record. Name the closing auction and currency.",
    rules: "Define the exact ticker, listing venue, close type, currency, session date, time zone, and comparison rule.",
    voidRules: "Define treatment for halts, delisting, missing official close, corporate actions, and market closure.",
  },
  Commodities: {
    question: "Will the named commodity benchmark settle at or above the stated level?",
    source: "https://official-benchmark.example/settlement",
    sourceHint: "Use the named exchange or benchmark administrator and identify the exact contract or spot benchmark.",
    rules: "Define the benchmark, contract month, units, currency, settlement field, date, time zone, and comparison rule.",
    voidRules: "Define treatment for missing settlement, contract suspension, benchmark changes, and corrected publications.",
  },
  Sports: {
    question: "Will the named team or player win the stated event?",
    source: "https://official-league.example/results",
    sourceHint: "Use the official league, federation, tournament, or event organizer result page.",
    rules: "Define the event, participants, scheduled date, result field, overtime treatment, and result cutoff.",
    voidRules: "Define treatment for cancellation, postponement, abandonment, disqualification, and no official result.",
  },
  Economics: {
    question: "Will the named economic release be at or above the stated value?",
    source: "https://official-statistics.example/releases",
    sourceHint: "Use a government statistical agency, central bank, treasury, or regulator publication.",
    rules: "Define the series, geography, units, reference period, release edition, publication time, and comparison rule.",
    voidRules: "Define treatment for delayed releases, missing values, methodology changes, and later revisions.",
  },
  Weather: {
    question: "Will the named station record the stated weather condition during the stated interval?",
    source: "https://official-weather.example/observations",
    sourceHint: "Use a public meteorological authority and identify the exact station, field, and observation interval.",
    rules: "Define the station ID, measurement, units, interval, time zone, aggregation rule, and comparison rule.",
    voidRules: "Define treatment for station outages, missing observations, corrected data, and station replacement.",
  },
  Politics: {
    question: "Will the stated candidate, measure, or official action meet the exact condition?",
    source: "https://official-government.example/results",
    sourceHint: "Use the election authority, legislature, court, gazette, or another official government record.",
    rules: "Define the jurisdiction, office or action, controlling official record, cutoff, and certification requirement.",
    voidRules: "Define treatment for recounts, annulment, delayed certification, court intervention, and no final record.",
  },
  Technology: {
    question: "Will the named project publish or activate the stated release by the cutoff?",
    source: "https://official-project.example/releases",
    sourceHint: "Use the official project, standards body, signed release registry, or public repository release.",
    rules: "Define the project, release artifact or activation event, version, environment, cutoff, and time zone.",
    voidRules: "Define treatment for retracted releases, renamed versions, test-only launches, and unverifiable publication.",
  },
  Entertainment: {
    question: "Will the named nominee win the stated award or event?",
    source: "https://official-event.example/results",
    sourceHint: "Use the official award body, broadcaster, chart publisher, or event organizer.",
    rules: "Define the event, category, nominee, controlling result, ceremony or publication date, and cutoff.",
    voidRules: "Define treatment for cancellation, shared awards, category changes, retractions, and no official result.",
  },
  Other: {
    question: "Enter one objective YES or NO question",
    source: "https://official-source.example/result",
    sourceHint: "Use the authority that directly controls or publishes the result. Explain why it is authoritative.",
    rules: "Define the exact observable result, source field, units if any, cutoff, time zone, and comparison rule.",
    voidRules: "Define every missing, cancelled, ambiguous, conflicting, or unverifiable condition that returns refunds.",
  },
};

export function isPriceCategory(category: string): category is PriceCategory {
  return Object.prototype.hasOwnProperty.call(PRICE_CATEGORY_ASSETS, category);
}

export function assetsForCategory(category: string, oracleMode: "free" | "pyth_pro" = "free"): readonly string[] {
  if (!isPriceCategory(category)) return [];
  const assets = PRICE_CATEGORY_ASSETS[category] as readonly string[];
  if (oracleMode === "free") return assets;
  return assets.filter((asset) => (PYTH_PRO_RESOLVABLE_ASSETS as readonly string[]).includes(asset));
}

export function eventGuidance(category: string) {
  return EVENT_SOURCE_GUIDANCE[category as EventCategory] ?? EVENT_SOURCE_GUIDANCE.Other;
}
