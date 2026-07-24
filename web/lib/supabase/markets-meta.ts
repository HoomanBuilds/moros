"use client";

import { getBrowserClient } from "./client";
import { signInWithWallet, type SocialAuthResult } from "./auth";

type RegistryAuthClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { app_metadata?: Record<string, unknown> } | null };
      error: { message: string } | null;
    }>;
  };
};

type RegistryWriteError = {
  code?: string;
  message: string;
};

export async function ensureMarketRegistrySession(
  client: RegistryAuthClient,
  creator: string,
  signIn: (expectedAddress?: string) => Promise<SocialAuthResult> = signInWithWallet,
): Promise<void> {
  const current = await client.auth.getUser();
  if (!current.error && current.data.user?.app_metadata?.wallet === creator) return;

  const result = await signIn(creator);
  if (!result.ok) throw new Error(result.error);

  const verified = await client.auth.getUser();
  if (verified.error) {
    throw new Error(`Wallet sign-in could not be verified: ${verified.error.message}`);
  }
  if (verified.data.user?.app_metadata?.wallet !== creator) {
    throw new Error("The registry session does not match the connected Stellar wallet. Retry market setup.");
  }
}

export function marketRegistryErrorMessage(error: RegistryWriteError): string {
  if (error.code === "42501") {
    return "The public registry could not authorize this wallet. Retry market setup and approve wallet sign-in.";
  }
  if (error.code === "PGRST204" || error.code === "42703") {
    return "The public market registry is missing a required database migration.";
  }
  if (error.code === "23514") {
    return "The public registry rejected the market metadata because it did not satisfy the listing rules.";
  }
  const code = error.code ? ` (${error.code})` : "";
  return `The public registry could not list this market: ${error.message}${code}`;
}

export type MarketMeta = {
  market_id: string;
  title: string | null;
  description: string | null;
  banner_url: string | null;
  category: string | null;
  subject: string | null;
  banner_source_url: string | null;
  banner_attribution: string | null;
  banner_license: string | null;
  banner_license_url: string | null;
  resolver_type: "price" | "event" | null;
  resolution_source: string | null;
  resolution_backup_sources: string[] | null;
  resolution_rules: string | null;
  void_rules: string | null;
  rules_hash: string | null;
};

export type RegistryMarket = {
  marketId: string;
  poolId: string;
  asset: string;
  collateralCode?: string;
  collateralIssuer?: string | null;
  collateralSac?: string;
  collateralDecimals?: number;
  createdAt?: number;
  title?: string;
  category?: string;
  subject?: string;
  bannerUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolverType?: "price" | "event";
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
  rulesHash?: string;
  proposalId?: string;
  factoryId?: string;
  liquidityVaultId?: string;
  marketState?: "funding" | "ready" | "active" | "cancelled" | "settled";
  liquidityTarget?: string;
  fundingDeadline?: number;
  activationCutoff?: number;
  settlementTime?: number;
};

const REGISTRY_SELECT = "market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, title, category, subject, banner_url, banner_source_url, banner_attribution, banner_license, banner_license_url, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash, proposal_id, factory_id, liquidity_vault_id, market_state, liquidity_target, funding_deadline, activation_cutoff, settlement_time, created_at";

function mapRegistryMarket(r: Record<string, unknown>): RegistryMarket {
  return {
    marketId: r.market_id as string,
    poolId: r.pool_id ? String(r.pool_id) : "",
    asset: String(r.asset ?? "").toUpperCase(),
    collateralCode: r.collateral_code ? String(r.collateral_code).toUpperCase() : undefined,
    collateralIssuer: r.collateral_issuer ? String(r.collateral_issuer) : null,
    collateralSac: r.collateral_sac ? String(r.collateral_sac) : undefined,
    collateralDecimals: typeof r.collateral_decimals === "number" ? r.collateral_decimals : undefined,
    createdAt: r.created_at ? Date.parse(r.created_at as string) : undefined,
    title: r.title ? String(r.title) : undefined,
    category: r.category ? String(r.category) : undefined,
    subject: r.subject ? String(r.subject) : undefined,
    bannerUrl: r.banner_url ? String(r.banner_url) : undefined,
    bannerSourceUrl: r.banner_source_url ? String(r.banner_source_url) : undefined,
    bannerAttribution: r.banner_attribution ? String(r.banner_attribution) : undefined,
    bannerLicense: r.banner_license ? String(r.banner_license) : undefined,
    bannerLicenseUrl: r.banner_license_url ? String(r.banner_license_url) : undefined,
    resolverType: r.resolver_type === "event" ? "event" : r.resolver_type === "price" ? "price" : undefined,
    resolutionSource: r.resolution_source ? String(r.resolution_source) : undefined,
    backupResolutionSources: Array.isArray(r.resolution_backup_sources)
      ? r.resolution_backup_sources.map(String)
      : undefined,
    resolutionRules: r.resolution_rules ? String(r.resolution_rules) : undefined,
    voidRules: r.void_rules ? String(r.void_rules) : undefined,
    rulesHash: r.rules_hash ? String(r.rules_hash) : undefined,
    proposalId: r.proposal_id ? String(r.proposal_id) : undefined,
    factoryId: r.factory_id ? String(r.factory_id) : undefined,
    liquidityVaultId: r.liquidity_vault_id ? String(r.liquidity_vault_id) : undefined,
    marketState: ["funding", "ready", "active", "cancelled", "settled"].includes(String(r.market_state))
      ? r.market_state as RegistryMarket["marketState"]
      : undefined,
    liquidityTarget: r.liquidity_target ? String(r.liquidity_target) : undefined,
    fundingDeadline: r.funding_deadline ? Date.parse(String(r.funding_deadline)) : undefined,
    activationCutoff: r.activation_cutoff ? Date.parse(String(r.activation_cutoff)) : undefined,
    settlementTime: r.settlement_time ? Date.parse(String(r.settlement_time)) : undefined,
  };
}

export async function getMarketMeta(marketId: string): Promise<MarketMeta | null> {
  const client = getBrowserClient();
  if (!client) return null;

  const { data, error } = await client
    .from("markets_meta")
    .select("market_id, title, description, banner_url, category, subject, banner_source_url, banner_attribution, banner_license, banner_license_url, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash")
    .eq("market_id", marketId)
    .maybeSingle();

  if (error) throw new Error(marketRegistryErrorMessage(error));
  if (!data) return null;
  return data as MarketMeta;
}

export async function fetchMarketRegistry(): Promise<RegistryMarket[]> {
  const client = getBrowserClient();
  if (!client) return [];

  const { data, error } = await client
    .from("markets_meta")
    .select(REGISTRY_SELECT)
    .not("pool_id", "is", null)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as Record<string, unknown>[])
    .filter((r) => r.market_id && r.pool_id)
    .map(mapRegistryMarket);
}

export async function fetchFundingMarkets(): Promise<RegistryMarket[]> {
  const client = getBrowserClient();
  if (!client) return [];

  const { data, error } = await client
    .from("markets_meta")
    .select(REGISTRY_SELECT)
    .in("market_state", ["funding", "ready"])
    .not("proposal_id", "is", null)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .filter((row) =>
      row.market_id
      && row.proposal_id
      && row.factory_id
      && row.liquidity_vault_id
      && row.liquidity_target
      && row.funding_deadline
      && row.activation_cutoff
      && row.settlement_time
    )
    .map(mapRegistryMarket);
}

export async function fetchLiquidityMarkets(): Promise<RegistryMarket[]> {
  const client = getBrowserClient();
  if (!client) return [];
  const { data, error } = await client
    .from("markets_meta")
    .select(REGISTRY_SELECT)
    .not("liquidity_vault_id", "is", null)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .filter((row) => row.market_id && row.liquidity_vault_id)
    .map(mapRegistryMarket);
}

export async function saveMarketToRegistry(entry: {
  marketId: string;
  poolId?: string;
  asset: string;
  collateralCode: string;
  collateralIssuer: string | null;
  collateralSac: string;
  collateralDecimals: number;
  creator: string;
  title?: string;
  category?: string;
  subject?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  description?: string;
  resolverType?: "price" | "event";
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
  rulesHash?: string;
  proposalId?: string;
  factoryId?: string;
  liquidityVaultId?: string;
  marketState?: "funding" | "ready" | "active" | "cancelled" | "settled";
  liquidityTarget?: string;
  fundingDeadline?: number;
  activationCutoff?: number;
  settlementTime?: number;
}): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("The public market registry is not configured.");

  await ensureMarketRegistrySession(client, entry.creator);

  const { data, error } = await client.from("markets_meta").upsert(
    {
      market_id: entry.marketId,
      pool_id: entry.poolId ?? null,
      asset: entry.asset,
      collateral_code: entry.collateralCode,
      collateral_issuer: entry.collateralIssuer,
      collateral_sac: entry.collateralSac,
      collateral_decimals: entry.collateralDecimals,
      creator: entry.creator,
      title: entry.title ?? null,
      description: entry.description ?? null,
      category: entry.category ?? null,
      subject: entry.subject ?? null,
      banner_source_url: entry.bannerSourceUrl ?? null,
      banner_attribution: entry.bannerAttribution ?? null,
      banner_license: entry.bannerLicense ?? null,
      banner_license_url: entry.bannerLicenseUrl ?? null,
      resolver_type: entry.resolverType ?? "price",
      resolution_source: entry.resolutionSource ?? null,
      resolution_backup_sources: entry.backupResolutionSources ?? [],
      resolution_rules: entry.resolutionRules ?? null,
      void_rules: entry.voidRules ?? null,
      rules_hash: entry.rulesHash ?? null,
      proposal_id: entry.proposalId ?? null,
      factory_id: entry.factoryId ?? null,
      liquidity_vault_id: entry.liquidityVaultId ?? null,
      market_state: entry.marketState ?? "active",
      liquidity_target: entry.liquidityTarget ?? null,
      funding_deadline: entry.fundingDeadline
        ? new Date(entry.fundingDeadline).toISOString()
        : null,
      activation_cutoff: entry.activationCutoff
        ? new Date(entry.activationCutoff).toISOString()
        : null,
      settlement_time: entry.settlementTime
        ? new Date(entry.settlementTime).toISOString()
        : null,
    },
    { onConflict: "market_id" },
  ).select("market_id").maybeSingle();

  if (error) throw new Error(marketRegistryErrorMessage(error));
  if (data?.market_id !== entry.marketId) {
    throw new Error("The public registry did not confirm the market listing. Retry market setup.");
  }
}
