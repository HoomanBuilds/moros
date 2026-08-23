import { DatabasePaymentSyncService } from "./payment-sync-database.mjs";
import {
  FilePaymentSyncStore,
  MemoryPaymentSyncStore,
  PaymentSyncService,
} from "./payment-sync.mjs";
import {
  SupabasePaymentSyncRepository,
  paymentSyncSupabaseConfig,
} from "./payment-sync-supabase.mjs";

export function createPaymentSyncService({
  network,
  vault,
  localStatePath,
  env = process.env,
  fetchImpl = fetch,
  now,
  random,
}) {
  if (paymentSyncSupabaseConfig(env)) {
    return new DatabasePaymentSyncService({
      repository: new SupabasePaymentSyncRepository({ network, vault, env, fetchImpl }),
      network,
      vault,
      now,
      random,
    });
  }
  if (env.NODE_ENV === "production") {
    throw new Error("production private payment sync requires Moros Supabase");
  }
  const store = localStatePath
    ? new FilePaymentSyncStore(localStatePath)
    : new MemoryPaymentSyncStore();
  return new PaymentSyncService({ store, network, vault, now, random });
}
