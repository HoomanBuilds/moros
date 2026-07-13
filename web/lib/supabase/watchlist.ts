"use client";

import { getBrowserClient } from "./client";

export async function isWatched(wallet: string, marketId: string): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  const { data, error } = await client
    .from("watchlist")
    .select("market_id")
    .eq("wallet", wallet)
    .eq("market_id", marketId)
    .maybeSingle();

  return !error && !!data;
}

export async function toggleWatch(wallet: string, marketId: string): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  const watched = await isWatched(wallet, marketId);
  if (watched) {
    const { error } = await client.from("watchlist").delete().eq("wallet", wallet).eq("market_id", marketId);
    return error ? true : false;
  }

  const { error } = await client.from("watchlist").insert({ wallet, market_id: marketId });
  return error ? false : true;
}
