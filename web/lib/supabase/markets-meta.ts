"use client";

import { getBrowserClient } from "./client";
import { signInWithWallet } from "./auth";

export type MarketMeta = {
  market_id: string;
  title: string | null;
  description: string | null;
  banner_url: string | null;
  category: string | null;
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
};

export async function getMarketMeta(marketId: string): Promise<MarketMeta | null> {
  const client = getBrowserClient();
  if (!client) return null;

  const { data, error } = await client
    .from("markets_meta")
    .select("market_id, title, description, banner_url, category")
    .eq("market_id", marketId)
    .maybeSingle();

  if (error || !data) return null;
  return data as MarketMeta;
}

export async function fetchMarketRegistry(): Promise<RegistryMarket[]> {
  const client = getBrowserClient();
  if (!client) return [];

  const { data, error } = await client
    .from("markets_meta")
    .select("market_id, pool_id, asset, collateral_code, collateral_issuer, collateral_sac, collateral_decimals, created_at")
    .not("pool_id", "is", null)
    .order("created_at", { ascending: false });

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
}): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  const { data } = await client.auth.getSession();
  if (!data?.session) {
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
      creator: entry.creator,
      title: entry.title ?? null,
      category: entry.category ?? null,
    },
    { onConflict: "market_id" },
  );

  return !error;
}
