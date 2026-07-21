import assert from "node:assert";
import { registerPool } from "./client.ts";

const originalFetch = globalThis.fetch;
const marketId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const poolId = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB67U";

async function main() {
  try {
    let submitted: unknown;
    globalThis.fetch = (async (_input, init) => {
      submitted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ registered: true }), { status: 200 });
    }) as typeof fetch;
    await registerPool(marketId, poolId);
    assert.deepEqual(submitted, { marketId, poolId });

    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "pool security configuration mismatch" }), {
      status: 400,
    })) as typeof fetch;
    await assert.rejects(
      registerPool(marketId, poolId),
      /service registration was rejected: pool security configuration mismatch.*Retry market setup/,
    );

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await assert.rejects(
      registerPool(marketId, poolId),
      /Moros services could not be reached.*Retry market setup/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("committee registration client ok");
}

void main();
