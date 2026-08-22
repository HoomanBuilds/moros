import assert from "node:assert/strict";
import { PaymentApi } from "./payment-api.mjs";

const actionId = "11".repeat(32);
const locator = Buffer.alloc(32, 2).toString("base64url");
const signingKey = Buffer.alloc(32, 3).toString("base64url");
const challenge = Buffer.alloc(32, 4).toString("base64url");
const signature = Buffer.alloc(64, 5).toString("base64url");
const page = Buffer.alloc(4_221, 6).toString("base64");
const calls = [];

const relay = {
  issueQuote(input) {
    calls.push(["quote", input]);
    return {
      xdr: "quote-xdr",
      quoteId: Buffer.alloc(32, 7),
      signingKey: Buffer.alloc(32, 8),
      paymentIdentity: {
        spendPublicKey: 1n,
        viewingPublicKeyX: 2n,
        viewingPublicKeyY: 3n,
      },
      fee: 0n,
      expiry: 1_780_000_100n,
    };
  },
  async relay(input) {
    calls.push(["relay", input]);
    return { hash: "abc" };
  },
};
const indexer = {
  summary: () => ({ nextLeafIndex: 4 }),
  outputs: (input) => ({ ...input, outputs: [] }),
  attachment: (id) => ({ actionId: id }),
  action: (id) => ({ actionId: id }),
};
const sync = {
  issueChallenge(input) {
    calls.push(["challenge", input]);
    return { challenge: Buffer.alloc(32, 4), expiresAt: 1_780_000_100 };
  },
  authenticate(input) {
    calls.push(["authenticate", input]);
    return { token: "session", expiresAt: 1_780_000_900 };
  },
  manifest: (token) => ({ token, generation: 0 }),
  pages: (token, input) => ({ token, ...input, pages: [] }),
  putPage(token, value) {
    calls.push(["page", token, value]);
    return { page: 0 };
  },
  commitGeneration(token, input) {
    calls.push(["commit", token, input]);
    return { generation: input.generation };
  },
  deleteGenerationsBefore: (token, minimum) => ({ token, minimum }),
};
const api = new PaymentApi({
  relay,
  indexer,
  sync,
  allowedOrigins: ["https://pay.moros.fun"],
});

function request(path, { method = "GET", value, token, origin = "https://pay.moros.fun" } = {}) {
  const headers = { origin };
  if (value !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`https://api.moros.fun${path}`, {
    method,
    headers,
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}

async function payload(response) {
  return { status: response.status, value: response.status === 204 ? null : await response.json() };
}

assert.deepEqual(await payload(await api.handle(request("/v1/health"))), {
  status: 200,
  value: { status: "ok", index: { nextLeafIndex: 4 } },
});
const quoteResponse = await payload(await api.handle(request("/v1/relay/quote", {
  method: "POST",
  value: { actionId, actionExpiry: 1_780_000_200 },
})));
assert.equal(quoteResponse.status, 200);
assert.equal(quoteResponse.value.fee, "0");
assert.equal(quoteResponse.value.paymentIdentity.spendPublicKey, "1");
assert.equal(calls[0][1].actionId.toString("hex"), actionId);

assert.equal((await payload(await api.handle(request("/v1/relay/submit", {
  method: "POST",
  value: { contract: "CA", method: "transfer", args: [] },
})))).value.hash, "abc");
assert.deepEqual((await payload(await api.handle(request("/v1/outputs?from=2&limit=20")))).value, {
  fromLeafIndex: 2,
  limit: 20,
  outputs: [],
});
assert.equal((await payload(await api.handle(request(`/v1/attachments/${actionId}`)))).value.attachment.actionId, actionId);
assert.equal((await payload(await api.handle(request(`/v1/actions/${actionId}`)))).value.action.actionId, actionId);

assert.equal((await payload(await api.handle(request("/v1/sync/challenge", {
  method: "POST",
  value: { locator, signingKey },
})))).value.challenge, challenge);
assert.equal((await payload(await api.handle(request("/v1/sync/authenticate", {
  method: "POST",
  value: {
    locator,
    signingKey,
    challenge,
    expiresAt: 1_780_000_100,
    signature,
  },
})))).value.token, "session");
assert.equal((await payload(await api.handle(request("/v1/sync/manifest", { token: "session" })))).value.generation, 0);
assert.equal((await payload(await api.handle(request("/v1/sync/pages?generation=1&from=0&limit=4", { token: "session" })))).value.limit, 4);
assert.equal((await payload(await api.handle(request("/v1/sync/pages", {
  method: "PUT",
  token: "session",
  value: { page },
})))).value.page, 0);
assert.equal(calls.find((entry) => entry[0] === "page")[2].length, 4_221);
assert.equal((await payload(await api.handle(request("/v1/sync/commit", {
  method: "POST",
  token: "session",
  value: {
    generation: 1,
    pageCount: 1,
    headHash: "22".repeat(32),
    expectedParentHash: "00".repeat(32),
  },
})))).value.generation, 1);
assert.equal((await payload(await api.handle(request("/v1/sync/generations?before=2", {
  method: "DELETE",
  token: "session",
})))).value.minimum, 2);

const options = await api.handle(request("/v1/outputs", { method: "OPTIONS" }));
assert.equal(options.status, 204);
assert.equal(options.headers.get("access-control-allow-origin"), "https://pay.moros.fun");
assert.equal((await api.handle(request("/v1/health", { origin: "https://evil.example" }))).status, 403);
assert.equal((await api.handle(request("/v1/unknown"))).status, 404);
assert.equal((await api.handle(request("/v1/relay/quote", {
  method: "POST",
  value: { actionId, actionExpiry: 1, email: "not-accepted@example.com" },
}))).status, 400);
assert.equal((await api.handle(new Request("https://api.moros.fun/v1/relay/quote", {
  method: "POST",
  headers: { origin: "https://pay.moros.fun", "content-type": "text/plain" },
  body: "{}",
}))).status, 400);

process.stdout.write("payment API tests passed\n");
