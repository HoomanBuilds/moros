"use client";

import { getKit } from "@/lib/wallet";
import { getBrowserClient } from "./client";

export type Profile = {
  wallet: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export async function getProfile(wallet: string): Promise<Profile | null> {
  const client = getBrowserClient();
  if (!client) return null;

  const { data, error } = await client.from("profiles").select("*").eq("wallet", wallet).maybeSingle();
  if (error || !data) return null;
  return data as Profile;
}

export async function upsertProfile(fields: { display_name?: string; avatar_url?: string }): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  try {
    const { address } = await getKit().getAddress();
    if (!address) return false;

    const { error } = await client.from("profiles").upsert({ wallet: address, ...fields });
    return !error;
  } catch {
    return false;
  }
}

export async function uploadAvatar(file: File): Promise<string | null> {
  const client = getBrowserClient();
  if (!client) return null;

  try {
    const { address } = await getKit().getAddress();
    if (!address) return null;

    const ext = file.name.split(".").pop() ?? "png";
    const path = `${address}/avatar-${Date.now()}.${ext}`;
    const { error } = await client.storage.from("avatars").upload(path, file, { upsert: true });
    if (error) return null;

    const { data } = client.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}
