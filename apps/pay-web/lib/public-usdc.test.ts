import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { formatUsdcAtomic, loadPublicUsdcBalance } from "./public-usdc";

const account = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const issuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

assert.equal(formatUsdcAtomic(null), "--");
assert.equal(formatUsdcAtomic(0n), "0");
assert.equal(formatUsdcAtomic(10_000_001n), "1.0000001");
assert.equal(formatUsdcAtomic(120_000_000n), "12");
assert.throws(() => formatUsdcAtomic(-1n), /negative/);

const originalFetch = globalThis.fetch;
let defaultFetchCalled = false;
globalThis.fetch = function () {
  assert.equal(this, globalThis);
  defaultFetchCalled = true;
  return Promise.resolve(response(404, { status: 404 }));
};
try {
  await loadPublicUsdcBalance({ horizonUrl: "https://horizon.example", address: account, issuer });
  assert.equal(defaultFetchCalled, true);
} finally {
  globalThis.fetch = originalFetch;
}

const inactive = await loadPublicUsdcBalance({
  horizonUrl: "https://horizon.example",
  address: account,
  issuer,
  fetchImpl: async () => response(404, { status: 404 }),
});
assert.deepEqual(inactive, { accountActive: false, hasTrustline: false, balanceAtomic: 0n });

const noTrustline = await loadPublicUsdcBalance({
  horizonUrl: "https://horizon.example",
  address: account,
  issuer,
  fetchImpl: async () => response(200, { balances: [{ asset_type: "native", balance: "10.0" }] }),
});
assert.deepEqual(noTrustline, { accountActive: true, hasTrustline: false, balanceAtomic: 0n });

const funded = await loadPublicUsdcBalance({
  horizonUrl: "https://horizon.example",
  address: account,
  issuer,
  fetchImpl: async () => response(200, {
    balances: [{ asset_code: "USDC", asset_issuer: issuer, balance: "42.1234567" }],
  }),
});
assert.deepEqual(funded, { accountActive: true, hasTrustline: true, balanceAtomic: 421_234_567n });

await assert.rejects(
  loadPublicUsdcBalance({
    horizonUrl: "https://horizon.example",
    address: account,
    issuer,
    fetchImpl: async () => response(200, { balances: [{ asset_code: "USDC", asset_issuer: issuer, balance: "1.12345678" }] }),
  }),
  /invalid USDC balance/,
);
