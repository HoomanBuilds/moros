import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NETWORK } from "@/lib/network";

async function main() {
  const deployment = JSON.parse(readFileSync(
    resolve(process.cwd(), `../deployments/private-${NETWORK.id}.json`),
    "utf8",
  ));
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = (async (input) => {
    assert.match(String(input), /\/private\/config$/u);
    requests++;
    if (requests === 1) {
      return Response.json(
        { error: "temporary failure" },
        { status: 503 },
      );
    }
    return Response.json({
      ...deployment,
      artifactBase: "/zk/private",
    });
  }) as typeof fetch;

  try {
    const { getPrivateConfig } = await import("./client");
    await assert.rejects(getPrivateConfig(), /temporary failure/u);
    const [first, second, third] = await Promise.all([
      getPrivateConfig(),
      getPrivateConfig(),
      getPrivateConfig(),
    ]);
    assert.equal(requests, 2);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.equal(first.network, NETWORK.id);
    assert.equal(
      first.contracts.sharedVault,
      deployment.contracts.sharedVault,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("private config cache ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
