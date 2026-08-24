import assert from "node:assert/strict";
import { createPaymentClient } from "./payment-client";
import { testDeployment } from "./test-deployment";

const originalFetch = globalThis.fetch;
let called = false;
globalThis.fetch = function () {
  assert.equal(this, globalThis);
  called = true;
  return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
};

try {
  const result = await createPaymentClient(testDeployment(), { attempts: 1 }).health() as { status: string };
  assert.equal(result.status, "ok");
  assert.equal(called, true);
} finally {
  globalThis.fetch = originalFetch;
}
