import assert from "node:assert/strict";
import {
  SupabasePaymentSyncRepository,
  paymentSyncSupabaseConfig,
} from "./payment-sync-supabase.mjs";

const vault = `C${"A".repeat(55)}`;
const locator = Buffer.alloc(32, 7).toString("base64url");
const signingKey = Buffer.alloc(32, 8).toString("base64url");
const env = {
  PRIVATE_SYNC_SUPABASE_URL: "https://moros.supabase.co/",
  PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY: "server-secret",
};

assert.deepEqual(paymentSyncSupabaseConfig({}), null);
assert.deepEqual(paymentSyncSupabaseConfig(env), {
  url: "https://moros.supabase.co",
  key: "server-secret",
});
assert.deepEqual(paymentSyncSupabaseConfig({
  NEXT_PUBLIC_SUPABASE_URL: "https://moros.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-secret",
}), {
  url: "https://moros.supabase.co",
  key: "server-secret",
});
assert.throws(
  () => paymentSyncSupabaseConfig({ PRIVATE_SYNC_SUPABASE_URL: env.PRIVATE_SYNC_SUPABASE_URL }),
  /incomplete/,
);

const requests = [];
const responses = [
  [],
  [{ current_generation: 0, current_epoch: 0, head_hash: "00".repeat(32), total_pages: 0 }],
];
const repository = new SupabasePaymentSyncRepository({
  network: "stellar:pubnet",
  vault,
  env,
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(await repository.account(locator), null);
const account = await repository.registerAccount(locator, signingKey);
assert.equal(account.signingKey, signingKey);
assert.equal(account.currentGeneration, 0);
assert.equal(requests[0].options.headers.authorization, "Bearer server-secret");
assert.equal(requests[1].url.endsWith("/rest/v1/rpc/register_payment_sync_account"), true);
assert.equal(JSON.parse(requests[1].options.body).target_locator, locator);

const failing = new SupabasePaymentSyncRepository({
  network: "stellar:pubnet",
  vault,
  env,
  fetchImpl: async () => new Response("unavailable", { status: 503 }),
});
await assert.rejects(() => failing.account(locator), /HTTP 503/);

const encodedPage = Buffer.alloc(4_221, 6).toString("base64");
const pageHash = "11".repeat(32);
const previousHash = "00".repeat(32);
const batchResponses = [
  null,
  [{ epoch: 1, parent_hash: previousHash }],
  null,
  [{
    page_number: 0,
    epoch: 1,
    previous_hash: previousHash,
    page_hash: pageHash,
    encoded_page: encodedPage,
  }],
];
const batchRequests = [];
const batchRepository = new SupabasePaymentSyncRepository({
  network: "stellar:pubnet",
  vault,
  env,
  fetchImpl: async (url, options) => {
    batchRequests.push({ url, options });
    return new Response(JSON.stringify(batchResponses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
const batch = await batchRepository.putPages(locator, [{
  generation: 1,
  epoch: 1,
  generationParentHash: previousHash,
  page: 0,
  hash: pageHash,
  previousHash,
  encoded: encodedPage,
}]);
assert.equal(batch[0].hash, pageHash);
assert.equal(Array.isArray(JSON.parse(batchRequests[2].options.body)), true);
assert.equal(batchRequests.length, 4);

process.stdout.write("Supabase payment sync tests passed\n");
