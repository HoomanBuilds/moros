"use client";

import { getKit } from "@/lib/wallet";
import { getBrowserClient } from "./client";

export type Comment = {
  id: string;
  market_id: string;
  wallet: string;
  body: string;
  parent_id: string | null;
  created_at: string;
};

export async function listComments(marketId: string): Promise<Comment[]> {
  const client = getBrowserClient();
  if (!client) return [];

  const { data, error } = await client
    .from("comments")
    .select("*")
    .eq("market_id", marketId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as Comment[];
}

export async function postComment(marketId: string, body: string, parentId?: string): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  try {
    const { address } = await getKit().getAddress();
    if (!address) return false;

    const { error } = await client.from("comments").insert({
      market_id: marketId,
      wallet: address,
      body,
      parent_id: parentId ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

export function subscribeComments(marketId: string, cb: (comment: Comment) => void): () => void {
  const client = getBrowserClient();
  if (!client) return () => {};

  const channel = client
    .channel(`comments-${marketId}`)
    .on<Comment>(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments", filter: `market_id=eq.${marketId}` },
      (payload) => cb(payload.new),
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
