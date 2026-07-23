import "server-only";
import { createClient } from "@supabase/supabase-js";

export function getPrivateSyncAdmin() {
  const url = process.env.PRIVATE_SYNC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "moros-private-sync" } },
  });
}
