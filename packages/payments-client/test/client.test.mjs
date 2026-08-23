import assert from "node:assert/strict";
import { MorosPaymentClient } from "../src/client.mjs";
import { deployment } from "./fixtures.mjs";

const requests = [];
const client = new MorosPaymentClient({
  deployment: deployment(),
  attempts: 1,
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
const actionId = Buffer.alloc(32, 1);
await client.quote({ actionId, actionExpiry: 1_780_000_000 });
await client.relay({ method: "transfer", args: ["xdr"] });
await client.outputs({ fromLeafIndex: 10, limit: 20 });
await client.attachment(actionId);
await client.action(actionId);
await client.syncChallenge({ locator: Buffer.alloc(32, 2), signingKey: Buffer.alloc(32, 3) });
await client.syncAuthenticate({
  locator: Buffer.alloc(32, 2),
  signingKey: Buffer.alloc(32, 3),
  challenge: Buffer.alloc(32, 4),
  expiresAt: 1_780_000_100,
  signature: Buffer.alloc(64, 5),
});
await client.syncManifest("session");
await client.syncPages("session", { generation: 2, fromPage: 3, limit: 4 });
await client.syncPutPage("session", Buffer.alloc(4_221));
await client.syncPutPages("session", [Buffer.alloc(4_221, 1), Buffer.alloc(4_221, 2)]);
await client.syncCommit("session", {
  generation: 2,
  pageCount: 1,
  headHash: Buffer.alloc(32, 6),
  expectedParentHash: Buffer.alloc(32, 7),
});
await client.syncDeleteGenerationsBefore("session", 2);

assert.equal(requests[0].url.endsWith("/v1/relay/quote"), true);
assert.deepEqual(JSON.parse(requests[0].options.body), {
  actionId: actionId.toString("hex"),
  actionExpiry: 1_780_000_000,
});
assert.equal(JSON.parse(requests[1].options.body).contract, client.deployment.vault);
assert.equal(requests[2].url.endsWith("/v1/outputs?from=10&limit=20"), true);
assert.equal(requests[7].options.headers.authorization, "Bearer session");
assert.equal(requests[8].url.includes("generation=2"), true);
assert.equal(JSON.parse(requests[9].options.body).page, Buffer.alloc(4_221).toString("base64"));
assert.equal(JSON.parse(requests[10].options.body).pages.length, 2);
assert.equal(requests[12].url.endsWith("/v1/sync/generations?before=2"), true);
assert.equal(requests[12].options.method, "DELETE");

assert.throws(
  () => client.syncChallenge({ locator: "not-canonical", signingKey: Buffer.alloc(32, 3) }),
  /archive locator/,
);
assert.throws(() => client.attachment("bad"), /action id/);
assert.throws(() => client.syncPutPages("session", []), /page batch/);
assert.throws(() => client.syncDeleteGenerationsBefore("session", 0), /minimum archive generation/);

process.stdout.write("Moros payment client tests passed\n");
