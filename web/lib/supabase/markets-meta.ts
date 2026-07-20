"use client";

import { getBrowserClient } from "./client";
import { signInWithWallet } from "./auth";

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
  protocolVersion?: 2 | 3;
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
    .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, protocol_version, title, category, subject, banner_url, banner_source_url, banner_attribution, banner_license, banner_license_url, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash, created_at")
    .not("pool_id", "is", null)
    .order("created_at", { ascending: false });
  let data = primary.data as Record<string, unknown>[] | null;
  let error = primary.error;

  if (error) {
    const fallback = await client
      .from("markets_meta")
      .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, protocol_version, title, category, resolver_type, resolution_source, resolution_backup_sources, resolution_rules, void_rules, rules_hash, created_at")
      .not("pool_id", "is", null)
      .order("created_at", { ascending: false });
    data = fallback.data as Record<string, unknown>[] | null;
    error = fallback.error;
  }

  if (error) {
    const fallback = await client
      .from("markets_meta")
      .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, protocol_version, title, category, resolver_type, resolution_source, resolution_rules, void_rules, rules_hash, created_at")
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
      protocolVersion: r.protocol_version === 3 ? 3 : 2,
      title: r.title ? String(r.title) : undefined,
      category: r.category ? String(r.category) : undefined,
      subject: r.subject ? String(r.subject) : undefined,
      bannerUrl: r.banner_url ? String(r.banner_url) : undefined,
      bannerSourceUrl: r.banner_source_url ? String(r.banner_source_url) : undefined,
      bannerAttribution: r.banner_attribution ? String(r.banner_attribution) : undefined,
      bannerLicense: r.banner_license ? String(r.banner_license) : undefined,
      bannerLicenseUrl: r.banner_license_url ? String(r.banner_license_url) : undefined,
      resolverType: r.resolver_type === "event" ? "event" : "price",
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
  protocolVersion?: 2 | 3;
  description?: string;
  resolverType?: "price" | "event";
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
  rulesHash?: string;
}): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  const { data } = await client.auth.getSession();
  const sessionWallet = data.session?.user.app_metadata?.wallet;
  if (sessionWallet !== entry.creator) {
    const result = await signInWithWallet(entry.creator);
    if (!result.ok) return false;
  }

  const { error } = await client.from("markets_meta").upsert(
    {
      market_id: entry.marketId,
      pool_id: entry.poolId,
      asset: entry.asset,
      collateral_code: entry.collateralCode,
      collateral_issuer: entry.collateralIssuer,
      collateral_sac: entry.collateralSac,
      collateral_decimals: entry.collateralDecimals,
      protocol_version: entry.protocolVersion ?? 2,
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
  );

  return !error;
}
