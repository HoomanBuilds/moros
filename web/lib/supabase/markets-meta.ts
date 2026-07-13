"use client";

import { getBrowserClient } from "./client";

export type MarketMeta = {
  market_id: string;
  title: string | null;
  description: string | null;
  banner_url: string | null;
  category: string | null;
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
