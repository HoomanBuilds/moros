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
    .select("market_id, pool_id, asset, created_at")
    .not("pool_id", "is", null)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data
    .filter((r) => r.market_id && r.pool_id)
    .map((r) => ({
      marketId: r.market_id as string,
      poolId: r.pool_id as string,
      asset: String(r.asset ?? "").toUpperCase(),
      createdAt: r.created_at ? Date.parse(r.created_at as string) : undefined,
    }));
}

export async function saveMarketToRegistry(entry: {
  marketId: string;
  poolId: string;
  asset: string;
  creator: string;
  title?: string;
  category?: string;
}): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  const { data } = await client.auth.getSession();
  if (!data?.session) {
    const ok = await signInWithWallet();
    if (!ok) return false;
  }

  const { error } = await client.from("markets_meta").upsert(
    {
      market_id: entry.marketId,
      pool_id: entry.poolId,
      asset: entry.asset,
      creator: entry.creator,
      title: entry.title ?? null,
      category: entry.category ?? null,
    },
    { onConflict: "market_id" },
  );

  return !error;
}
