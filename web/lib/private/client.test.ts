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
  let configRequests = 0;
  let catalogRequests = 0;
  let catalogFailure = true;

  const catalog = {
    checkedAt: "2026-08-03T00:00:00.000Z",
    markets: [{
      market: deployment.contracts.factory,
      checkedAt: "2026-08-03T00:00:00.000Z",
      state: ["0", "0", "4294967296"],
      priceYes: "2147483648",
      outcome: null,
      info: {
        asset: "XLM",
        threshold: "18900000000000",
        expiry: "2000000000",
        finalize_after: "2000000600",
      },
      scenario: { market_assets: "200000000" },
      registration: {
        market: deployment.contracts.factory,
        current_epoch: "1",
        lot_size: "4294967296",
        fee_bps: 50,
        maximum_batch_size: 8,
        minimum_side_count: 0,
      },
      epoch: {
        accepted_count: 0,
        last_sequence: "0",
        phase: "Collecting",
      },
      previousEpoch: {
        accepted_count: 2,
        last_sequence: "2",
        phase: "Executed",
      },
    }],
  };

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/private/catalog")) {
      catalogRequests++;
      if (catalogFailure) {
        catalogFailure = false;
        return Response.json(
          { error: "catalog temporarily unavailable" },
          { status: 503 },
        );
      }
      return Response.json(catalog);
    }
    assert.match(url, /\/private\/config$/u);
    configRequests++;
    if (configRequests === 1) {
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
    const {
      getPrivateConfig,
      getPrivateMarketCatalog,
      isPrivateMarketCatalogEntryFresh,
      isPrivateMarketCatalogSnapshotFresh,
      parsePrivateMarketCatalog,
    } = await import("./client");
    await assert.rejects(getPrivateConfig(), /temporary failure/u);
    const [first, second, third] = await Promise.all([
      getPrivateConfig(),
      getPrivateConfig(),
      getPrivateConfig(),
    ]);
    assert.equal(configRequests, 2);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.equal(first.network, NETWORK.id);
    assert.equal(
      first.contracts.sharedVault,
      deployment.contracts.sharedVault,
    );
    await assert.rejects(
      getPrivateMarketCatalog(),
      /catalog temporarily unavailable/u,
    );
    const [catalogA, catalogB] = await Promise.all([
      getPrivateMarketCatalog(),
      getPrivateMarketCatalog(),
    ]);
    assert.equal(catalogRequests, 2);
    assert.equal(catalogA, catalogB);
    assert.equal(catalogA.markets[0].previousEpoch?.last_sequence, "2");
    const catalogEntry = catalogA.markets[0];
    const catalogCheckedAt = Date.parse(catalogEntry.checkedAt);
    assert.equal(
      isPrivateMarketCatalogEntryFresh(
        catalogEntry,
        catalogCheckedAt + 89_999,
      ),
      true,
    );
    assert.equal(
      isPrivateMarketCatalogEntryFresh(
        catalogEntry,
        catalogCheckedAt + 90_001,
      ),
      false,
    );
    assert.equal(
      isPrivateMarketCatalogSnapshotFresh(
        catalogA,
        Date.parse(catalogA.checkedAt) + 89_999,
      ),
      true,
    );
    assert.equal(
      isPrivateMarketCatalogSnapshotFresh(
        catalogA,
        Date.parse(catalogA.checkedAt) + 90_001,
      ),
      false,
    );
    assert.equal(
      isPrivateMarketCatalogEntryFresh(
        catalogEntry,
        catalogCheckedAt - 60_001,
      ),
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    await getPrivateMarketCatalog(0);
    assert.equal(catalogRequests, 3);
    assert.throws(
      () => parsePrivateMarketCatalog({ ...catalog, checkedAt: "invalid" }),
      /catalog is invalid/u,
    );
    assert.throws(
      () => parsePrivateMarketCatalog({
        ...catalog,
        markets: [{ ...catalog.markets[0], priceYes: "4294967297" }],
      }),
      /catalog is invalid/u,
    );
    assert.throws(
      () => parsePrivateMarketCatalog({
        ...catalog,
        markets: [{ ...catalog.markets[0], registration: null }],
      }),
      /catalog is invalid/u,
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
