import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import {
  parseRange,
  PrivateArtifactStore,
} from "./private-artifacts.mjs";
import { PrivateAllocationRegistry } from "./private-allocation-registry.mjs";
import { PrivateExitRegistry } from "./private-exit-registry.mjs";
import { PrivateMarketRegistry } from "./private-market-registry.mjs";
import { PrivateProposalRegistry } from "./private-proposal-registry.mjs";

assert.deepEqual(
  parseRange(undefined, 100),
  { start: 0, end: 99, partial: false },
);
assert.deepEqual(
  parseRange("bytes=10-19", 100),
  { start: 10, end: 19, partial: true },
);
assert.deepEqual(
  parseRange("bytes=90-", 100),
  { start: 90, end: 99, partial: true },
);
assert.deepEqual(
  parseRange("bytes=-10", 100),
  { start: 90, end: 99, partial: true },
);
assert.throws(() => parseRange("bytes=100-101", 100), /outside/);
assert.throws(() => parseRange("items=1-2", 100), /invalid/);

const artifactDirectory = mkdtempSync(resolve(tmpdir(), "moros-private-artifacts-"));
try {
  writeFileSync(
    resolve(artifactDirectory, "manifest.json"),
    JSON.stringify({
      network: "testnet",
      mainnet_ready: false,
      setup_manifest_sha256: "setup-hash",
      circuits: [],
    }),
  );
  const artifacts = new PrivateArtifactStore({
    root: artifactDirectory,
    deployment: { provingManifestSha256: "setup-hash" },
  });
  let responseStatus;
  let responseHeaders;
  assert.equal(
    artifacts.serve(
      { headers: {}, method: "HEAD" },
      {
        writeHead(status, headers) {
          responseStatus = status;
          responseHeaders = headers;
        },
        end() {},
      },
      "manifest.json",
      {
        "access-control-allow-origin": "https://moros.example",
        vary: "origin",
      },
    ),
    true,
  );
  assert.equal(responseStatus, 200);
  assert.equal(
    responseHeaders["access-control-allow-origin"],
    "https://moros.example",
  );
  assert.equal(responseHeaders.vary, "origin");
} finally {
  rmSync(artifactDirectory, { recursive: true, force: true });
}

const directory = mkdtempSync(resolve(tmpdir(), "moros-private-markets-"));
const stateFile = resolve(directory, "markets.json");
const market = StrKey.encodeContract(Buffer.alloc(32, 4));
const verified = [];

try {
  const registry = new PrivateMarketRegistry({
    stateFile,
    verify: async (value) => verified.push(value),
  });
  await registry.register(market);
  await registry.register(market);
  assert.deepEqual(registry.list(), [market]);
  assert.deepEqual(verified, [market, market]);

  const resumed = new PrivateMarketRegistry({
    stateFile,
    verify: async () => {},
  });
  assert.deepEqual(resumed.list(), [market]);
  await assert.rejects(() => resumed.register("bad"), /invalid/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const proposalDirectory = mkdtempSync(resolve(tmpdir(), "moros-private-proposals-"));
const proposalFile = resolve(proposalDirectory, "proposals.json");
const liquidityVault = StrKey.encodeContract(Buffer.alloc(32, 5));
const proposalId = "a".repeat(64);

try {
  const proposals = new PrivateProposalRegistry({
    stateFile: proposalFile,
    verify: async (value) => ({
      proposalId: value,
      market,
      liquidityVault,
    }),
  });
  await proposals.register(proposalId);
  await proposals.register(proposalId);
  assert.deepEqual(proposals.list(), [{
    proposalId,
    market,
    liquidityVault,
  }]);
  await assert.rejects(() => proposals.register("bad"), /invalid proposal/);

  const resumed = new PrivateProposalRegistry({
    stateFile: proposalFile,
    verify: async () => {
      throw new Error("verification should not run while loading state");
    },
  });
  assert.deepEqual(resumed.list(), proposals.list());
} finally {
  rmSync(proposalDirectory, { recursive: true, force: true });
}

const exitDirectory = mkdtempSync(resolve(tmpdir(), "moros-private-exits-"));
const exitFile = resolve(exitDirectory, "exits.json");
const exitId = "b".repeat(64);
const secondLiquidityVault = StrKey.encodeContract(Buffer.alloc(32, 6));

try {
  const exits = new PrivateExitRegistry({
    stateFile: exitFile,
    verify: async (entry) => entry,
  });
  await exits.register({ market, liquidityVault, exitId });
  await exits.register({ market, liquidityVault, exitId });
  await exits.register({
    market,
    liquidityVault: secondLiquidityVault,
    exitId,
  });
  assert.equal(exits.list().length, 2);
  assert.ok(exits.list().some((entry) =>
    entry.liquidityVault === liquidityVault && entry.exitId === exitId
  ));
  assert.ok(exits.list().some((entry) =>
    entry.liquidityVault === secondLiquidityVault && entry.exitId === exitId
  ));
  await assert.rejects(
    () => exits.register({ market, liquidityVault, exitId: "bad" }),
    /invalid/,
  );

  const resumed = new PrivateExitRegistry({
    stateFile: exitFile,
    verify: async () => {
      throw new Error("verification should not run while loading state");
    },
  });
  assert.deepEqual(resumed.list(), exits.list());
} finally {
  rmSync(exitDirectory, { recursive: true, force: true });
}

const allocationDirectory = mkdtempSync(resolve(tmpdir(), "moros-private-allocations-"));
const allocationFile = resolve(allocationDirectory, "allocations.json");
const allocation = {
  market,
  epoch: 2n,
  positionCommitment: 123n,
  envelope: Array.from({ length: 20 }, (_, index) => BigInt(index)),
};

try {
  const allocations = new PrivateAllocationRegistry({
    stateFile: allocationFile,
  });
  allocations.putMany([allocation]);
  allocations.putMany([allocation]);
  assert.deepEqual(
    allocations.get(market, "2", "123"),
    {
      market,
      epoch: "2",
      positionCommitment: "123",
      envelope: Array.from({ length: 20 }, (_, index) => String(index)),
    },
  );
  assert.equal(allocations.get(market, "2", "124"), undefined);
  assert.throws(
    () => allocations.putMany([{ ...allocation, envelope: [1n] }]),
    /invalid/,
  );
  const resumed = new PrivateAllocationRegistry({
    stateFile: allocationFile,
  });
  assert.deepEqual(
    resumed.get(market, "2", "123"),
    allocations.get(market, "2", "123"),
  );
} finally {
  rmSync(allocationDirectory, { recursive: true, force: true });
}

process.stdout.write("private runtime tests passed\n");
