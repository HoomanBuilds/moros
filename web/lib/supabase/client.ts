"use client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseEnabled } from "./config";

let client: SupabaseClient | null = null;
export function getBrowserClient(): SupabaseClient | null {
  if (!supabaseEnabled()) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
  return client;
}
