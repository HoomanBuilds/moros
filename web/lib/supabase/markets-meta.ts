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
};

export async function getMarketMeta(marketId: string): Promise<MarketMeta | null> {
  const client = getBrowserClient();
  if (!client) return null;

  const { data, error } = await client
    .from("markets_meta")
    .select("market_id, title, description, banner_url, category, subject, banner_source_url, banner_attribution, banner_license, banner_license_url, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash")
    .eq("market_id", marketId)
    .maybeSingle();

  if (error) {
    const preMedia = await client
      .from("markets_meta")
      .select("market_id, title, description, banner_url, category, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash")
      .eq("market_id", marketId)
      .maybeSingle();
    if (!preMedia.error && preMedia.data) {
      return {
        ...preMedia.data,
        subject: null,
        banner_source_url: null,
        banner_attribution: null,
        banner_license: null,
        banner_license_url: null,
      } as MarketMeta;
    }
    const fallback = await client
      .from("markets_meta")
      .select("market_id, title, description, banner_url, category, resolver_type, resolution_source, resolution_rules, void_rules, rules_hash")
      .eq("market_id", marketId)
      .maybeSingle();
    if (!fallback.error && fallback.data) {
      return {
        ...fallback.data,
        subject: null,
        banner_source_url: null,
        banner_attribution: null,
        banner_license: null,
        banner_license_url: null,
        resolution_backup_sources: null,
      } as MarketMeta;
    }
    const legacy = await client
      .from("markets_meta")
      .select("market_id, title, description, banner_url, category, resolution_source")
      .eq("market_id", marketId)
      .maybeSingle();
    if (legacy.error || !legacy.data) return null;
    return {
      ...legacy.data,
      subject: null,
      banner_source_url: null,
      banner_attribution: null,
      banner_license: null,
      banner_license_url: null,
      resolver_type: "price",
      resolution_backup_sources: null,
      resolution_rules: null,
      void_rules: null,
      rules_hash: null,
    } as MarketMeta;
  }
  if (!data) return null;
  return data as MarketMeta;
}

export async function fetchMarketRegistry(): Promise<RegistryMarket[]> {
  const client = getBrowserClient();
  if (!client) return [];

  const primary = await client
    .from("markets_meta")
    .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, title, category, subject, banner_url, banner_source_url, banner_attribution, banner_license, banner_license_url, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash, created_at")
    .not("pool_id", "is", null)
    .order("created_at", { ascending: false });
  let data = primary.data as Record<string, unknown>[] | null;
  let error = primary.error;

  if (error) {
    const fallback = await client
      .from("markets_meta")
      .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, title, category, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash, created_at")
      .not("pool_id", "is", null)
      .order("created_at", { ascending: false });
    data = fallback.data as Record<string, unknown>[] | null;
    error = fallback.error;
  }

  if (error) {
    const fallback = await client
      .from("markets_meta")
      .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, title, category, resolver_type, resolution_source, resolution_rules, void_rules, rules_hash, created_at")
      .not("pool_id", "is", null)
      .order("created_at", { ascending: false });
    data = fallback.data as Record<string, unknown>[] | null;
    error = fallback.error;
  }

  if (error) {
    const legacy = await client
      .from("markets_meta")
      .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, created_at")
      .not("pool_id", "is", null)
      .order("created_at", { ascending: false });
    data = legacy.data as Record<string, unknown>[] | null;
    error = legacy.error;
  }

  if (error || !data) return [];

  return data
    .filter((r) => r.market_id && r.pool_id)
    .map((r) => ({
      marketId: r.market_id as string,
      poolId: r.pool_id as string,
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
    }));
}

export async function saveMarketToRegistry(entry: {
  marketId: string;
  poolId: string;
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
}): Promise<void> {
  const client = getBrowserClient();
  if (!client) throw new Error("The public market registry is not configured.");

  await ensureMarketRegistrySession(client, entry.creator);

  const { data, error } = await client.from("markets_meta").upsert(
    {
      market_id: entry.marketId,
      pool_id: entry.poolId,
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
    },
    { onConflict: "market_id" },
  ).select("market_id").maybeSingle();

  if (error) throw new Error(marketRegistryErrorMessage(error));
  if (data?.market_id !== entry.marketId) {
    throw new Error("The public registry did not confirm the market listing. Retry market setup.");
  }
}
