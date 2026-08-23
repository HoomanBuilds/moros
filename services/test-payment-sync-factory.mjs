import assert from "node:assert/strict";
import { DatabasePaymentSyncService } from "./payment-sync-database.mjs";
import { PaymentSyncService } from "./payment-sync.mjs";
import { createPaymentSyncService } from "./payment-sync-factory.mjs";

const vault = `C${"A".repeat(55)}`;
const local = createPaymentSyncService({
  network: "stellar:pubnet",
  vault,
  env: { NODE_ENV: "test" },
});
assert.equal(local instanceof PaymentSyncService, true);

const database = createPaymentSyncService({
  network: "stellar:pubnet",
  vault,
  env: {
    NODE_ENV: "production",
    PRIVATE_SYNC_SUPABASE_URL: "https://moros.supabase.co",
    PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY: "server-secret",
  },
  fetchImpl: async () => new Response("[]", { status: 200 }),
});
assert.equal(database instanceof DatabasePaymentSyncService, true);

assert.throws(() => createPaymentSyncService({
  network: "stellar:pubnet",
  vault,
  env: { NODE_ENV: "production" },
}), /requires Moros Supabase/);

process.stdout.write("payment sync factory tests passed\n");
