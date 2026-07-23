import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Networks,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { cfg } from "./config.mjs";
import {
  PrivateBatchCoordinator,
  createBatchProver,
  phaseName,
} from "./private-batch-coordinator.mjs";
import { PrivateAllocationRegistry } from "./private-allocation-registry.mjs";
import { PrivateArtifactStore } from "./private-artifacts.mjs";
import { PrivateExitRegistry } from "./private-exit-registry.mjs";
import { PrivateOutputIndexer } from "./private-indexer.mjs";
import { PrivateMarketRegistry } from "./private-market-registry.mjs";
import { PrivateProposalRegistry } from "./private-proposal-registry.mjs";
import {
  FixedWindowRateLimiter,
  decodeRelayRequest,
} from "./private-relayer.mjs";
import { jsonValue } from "./private-protocol.mjs";
import {
  contractClient,
  runtimeSource,
  submitInvocation,
} from "./soroban-runtime.mjs";
import { testnetPrivacyIdentity } from "./deployment-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PRIVATE_PORT || process.env.PORT || 8787);
const RPC_URL =
  process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const DEPLOYMENT_PATH = resolve(
  cfg.repo,
  process.env.MOROS_PUBLIC_DEPLOYMENT ||
    "deployments/private-testnet.json",
);
const ARTIFACT_ROOT = resolve(
  process.env.MOROS_ZK_PUBLIC_DIR ||
    resolve(cfg.repo, "circuits/private-build/public"),
);
const RUNTIME_ROOT = resolve(
  cfg.repo,
  process.env.MOROS_PRIVATE_RUNTIME_DIR ||
    "services/private-runtime",
);
const OUTPUT_STATE = resolve(RUNTIME_ROOT, "outputs.json");
const MARKET_STATE = resolve(RUNTIME_ROOT, "markets.json");
const PROPOSAL_STATE = resolve(RUNTIME_ROOT, "proposals.json");
const ALLOCATION_STATE = resolve(RUNTIME_ROOT, "allocations.json");
const EXIT_STATE = resolve(RUNTIME_ROOT, "exits.json");
const TICK_MS = Number(process.env.PRIVATE_TICK_MS || 10_000);
const MAX_BODY = 256 * 1024;
const ALLOWED_ORIGINS = new Set(
  (
    process.env.PUBLIC_ORIGINS ||
    "http://localhost:3000,https://moros-six.vercel.app"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function resultValue(value) {
  return value && Object.hasOwn(value, "result") ? value.result : value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exitKey(entry) {
  return `${entry.liquidityVault}:${entry.exitId}`;
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function responseHeaders(request) {
  const origin = request.headers.origin;
  return origin && ALLOWED_ORIGINS.has(origin)
    ? {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
        "access-control-allow-origin": origin,
        vary: "origin",
      }
    : {};
}

function sendJson(request, response, status, value) {
  const body = `${JSON.stringify(jsonValue(value))}\n`;
  response.writeHead(status, {
    ...responseHeaders(request),
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

function serializeTransactions() {
  let queue = Promise.resolve();
  return (operation) => {
    const current = queue.then(operation, operation);
    queue = current.catch(() => {});
    return current;
  };
}

async function syncPublicMarketState(proposalId, state, poolId) {
  const url =
    process.env.MARKET_REGISTRY_SUPABASE_URL ||
    process.env.PRIVATE_SYNC_SUPABASE_URL;
  const key =
    process.env.MARKET_REGISTRY_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false };
  const response = await fetch(
    `${url.replace(/\/+$/u, "")}/rest/v1/markets_meta?proposal_id=eq.${proposalId}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        market_state: state,
        pool_id: poolId || null,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `public market registry update failed with HTTP ${response.status}`,
    );
  }
  return { configured: true };
}

async function main() {
  if (
    cfg.network !== "testnet" ||
    NETWORK_PASSPHRASE !== Networks.TESTNET
  ) {
    throw new Error("the private service is testnet only");
  }
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
    throw new Error("invalid private service port");
  }
  if (!Number.isSafeInteger(TICK_MS) || TICK_MS < 2_000) {
    throw new Error("PRIVATE_TICK_MS must be at least 2000");
  }
  const deployment = readJson(DEPLOYMENT_PATH);
  if (
    deployment.network !== "testnet" ||
    deployment.mainnetReady !== false ||
    !deployment.contracts?.sharedVault ||
    !deployment.contracts?.factory
  ) {
    throw new Error("invalid private testnet deployment manifest");
  }
  const artifacts = new PrivateArtifactStore({
    root: ARTIFACT_ROOT,
    deployment,
  });
  const source = runtimeSource(process.env.FUNDER_SK || "");
  const server = new rpc.Server(RPC_URL);
  const vaultId = deployment.contracts.sharedVault;
  const vault = await contractClient({
    server,
    contractId: vaultId,
    source,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const vaultInfo = resultValue(await vault.info());
  if (
    vaultInfo.factory !== deployment.contracts.factory ||
    vaultInfo.verifier !== deployment.contracts.verifier ||
    vaultInfo.token !== deployment.collateral.contract ||
    Number(vaultInfo.levels) !== deployment.privacy.treeLevels ||
    Buffer.from(vaultInfo.verifier_domain).toString("hex") !==
      deployment.verifierDomain
  ) {
    throw new Error("shared vault wiring does not match the deployment");
  }
  const identity = testnetPrivacyIdentity(process.env.FUNDER_SK);
  const serialize = serializeTransactions();
  const factory = await contractClient({
    server,
    contractId: deployment.contracts.factory,
    source,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const indexer = new PrivateOutputIndexer({
    client: vault,
    stateFile: OUTPUT_STATE,
    vaultId,
    levels: Number(vaultInfo.levels),
  });
  await indexer.sync();

  const marketClients = new Map();
  const liquidityClients = new Map();
  const getMarketClient = async (market) => {
    if (!marketClients.has(market)) {
      marketClients.set(market, await contractClient({
        server,
        contractId: market,
        source,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      }));
    }
    return marketClients.get(market);
  };
  const getLiquidityClient = async (liquidityVault) => {
    if (!liquidityClients.has(liquidityVault)) {
      liquidityClients.set(liquidityVault, await contractClient({
        server,
        contractId: liquidityVault,
        source,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      }));
    }
    return liquidityClients.get(liquidityVault);
  };
  const registry = new PrivateMarketRegistry({
    stateFile: MARKET_STATE,
    verify: async (market) => {
      const registration = resultValue(
        await vault.registration({ market }),
      );
      if (
        !registration ||
        registration.market !== market ||
        Number(registration.fixed_batch_size) !==
          deployment.marketPolicy.fixedBatchSize ||
        Number(registration.minimum_side_count) !==
          deployment.marketPolicy.minimumSideCount
      ) {
        throw new Error("market is not an approved private deployment");
      }
      const wasm = await server.getContractWasmByContractId(market);
      if (hash(wasm) !== deployment.wasm.market) {
        throw new Error("market uses an unexpected WASM hash");
      }
      await getMarketClient(market);
    },
  });
  for (const market of registry.list()) await registry.register(market);
  const proposals = new PrivateProposalRegistry({
    stateFile: PROPOSAL_STATE,
    verify: async (proposalId) => {
      const encoded = Buffer.from(proposalId, "hex");
      const proposal = resultValue(await factory.proposal({
        proposal_id: encoded,
      }));
      if (
        !proposal ||
        Buffer.from(proposal.proposal_id).toString("hex") !== proposalId ||
        !proposal.liquidity_vault
      ) {
        throw new Error("proposal is not deployed by the configured factory");
      }
      const [market, liquidityVault] = await Promise.all([
        factory.market_address({ proposal_id: encoded }),
        factory.liquidity_address({ proposal_id: encoded }),
      ]);
      const expectedMarket = resultValue(market);
      const expectedLiquidity = resultValue(liquidityVault);
      if (
        proposal.liquidity_vault !== expectedLiquidity ||
        (proposal.market && proposal.market !== expectedMarket)
      ) {
        throw new Error("proposal deterministic addresses do not match");
      }
      return {
        proposalId,
        market: expectedMarket,
        liquidityVault: expectedLiquidity,
      };
    },
  });
  for (const proposal of proposals.list()) {
    await proposals.register(proposal.proposalId);
  }
  const exits = new PrivateExitRegistry({
    stateFile: EXIT_STATE,
    verify: async (entry) => {
      const market = await getMarketClient(entry.market);
      const privateConfig = resultValue(await market.private_config());
      if (
        !privateConfig ||
        privateConfig.batcher !== vaultId ||
        privateConfig.liquidity_vault !== entry.liquidityVault
      ) {
        throw new Error("liquidity exit market wiring does not match");
      }
      const liquidity = await getLiquidityClient(entry.liquidityVault);
      const [info, intent] = await Promise.all([
        liquidity.info(),
        liquidity.exit_intent({
          exit_id: Buffer.from(entry.exitId, "hex"),
        }),
      ]);
      const decodedInfo = resultValue(info);
      if (
        decodedInfo.share_controller !== vaultId ||
        decodedInfo.market !== entry.market ||
        !resultValue(intent)
      ) {
        throw new Error("liquidity exit is not registered on the linked vault");
      }
      return entry;
    },
  });
  for (const exit of exits.list()) await exits.register(exit);

  const batchRoot = resolve(ARTIFACT_ROOT, "batch");
  const allocations = new PrivateAllocationRegistry({
    stateFile: ALLOCATION_STATE,
  });
  const coordinator = new PrivateBatchCoordinator({
    vault,
    vaultId,
    networkDomain: Buffer.from(vaultInfo.network_domain),
    committeeSecret: identity.committeeSecret,
    marketClient: getMarketClient,
    prove: createBatchProver({
      wasmPath: resolve(batchRoot, "batch.wasm"),
      zkeyPath: resolve(batchRoot, "batch.zkey"),
      vkeyPath: resolve(batchRoot, "batch.vk.json"),
    }),
    publishAllocations: async (packages) => allocations.putMany(packages),
    submit: (transaction) =>
      serialize(async () => (await transaction).signAndSend()),
  });
  const perClient = new FixedWindowRateLimiter({
    limit: Number(process.env.PRIVATE_RELAY_LIMIT || 30),
    windowMs: 60_000,
  });
  const global = new FixedWindowRateLimiter({
    limit: Number(process.env.PRIVATE_GLOBAL_RELAY_LIMIT || 300),
    windowMs: 60_000,
  });
  const runtime = {
    startedAt: new Date().toISOString(),
    lastTickAt: null,
    lastIndexAt: new Date().toISOString(),
    outputs: Number(vaultInfo.next_leaf_index),
    markets: {},
    proposals: {},
    exits: {},
    errors: [],
  };
  let ticking = false;

  const processProposal = async (entry) => {
    const proposalId = Buffer.from(entry.proposalId, "hex");
    let proposal = resultValue(await factory.proposal({
      proposal_id: proposalId,
    }));
    if (!proposal) throw new Error("registered proposal no longer exists");
    let phase = phaseName(proposal.phase);
    const liquidity = await contractClient({
      server,
      contractId: entry.liquidityVault,
      source,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    let info = resultValue(await liquidity.info());
    const now = Math.floor(Date.now() / 1_000);

    if (phase === "Funding" && phaseName(info.phase) === "Ready") {
      await serialize(async () =>
        (await factory.sync_funding({
          proposal_id: proposalId,
          expected_version: BigInt(proposal.state_version),
        })).signAndSend()
      );
      proposal = resultValue(await factory.proposal({
        proposal_id: proposalId,
      }));
      phase = phaseName(proposal.phase);
    }

    if (
      ["Proposed", "Funding", "Ready"].includes(phase) &&
      (
        now > Number(proposal.activation_cutoff) ||
        (
          phase !== "Ready" &&
          now > Number(proposal.funding_deadline)
        )
      )
    ) {
      await serialize(async () =>
        (await factory.cancel({
          proposal_id: proposalId,
          expected_version: BigInt(proposal.state_version),
          liquidity_version: BigInt(info.state_version),
        })).signAndSend()
      );
      await syncPublicMarketState(entry.proposalId, "cancelled");
      return { phase: "Cancelled", market: entry.market };
    }

    if (phase === "Ready") {
      info = resultValue(await liquidity.info());
      await serialize(async () =>
        (await factory.activate({
          proposal_id: proposalId,
          expected_version: BigInt(proposal.state_version),
          liquidity_version: BigInt(info.state_version),
        })).signAndSend()
      );
      proposal = resultValue(await factory.proposal({
        proposal_id: proposalId,
      }));
      phase = phaseName(proposal.phase);
    }

    if (phase === "Active") {
      if (proposal.market !== entry.market) {
        throw new Error("activated proposal returned an unexpected market");
      }
      await registry.register(entry.market);
      const sync = await syncPublicMarketState(
        entry.proposalId,
        "active",
        vaultId,
      );
      return {
        phase,
        market: entry.market,
        registrySyncConfigured: sync.configured,
      };
    }
    if (phase === "Cancelled") {
      const sync = await syncPublicMarketState(entry.proposalId, "cancelled");
      return {
        phase,
        market: entry.market,
        registrySyncConfigured: sync.configured,
      };
    }
    return {
      phase,
      fundedAssets: info.funded_assets,
      targetAssets: info.target_assets,
      market: entry.market,
    };
  };

  const readExit = async (entry) => {
    const liquidity = await getLiquidityClient(entry.liquidityVault);
    const [intent, snapshot, info] = await Promise.all([
      liquidity.exit_intent({
        exit_id: Buffer.from(entry.exitId, "hex"),
      }),
      liquidity.market_snapshot(),
      liquidity.info(),
    ]);
    const decodedIntent = resultValue(intent);
    if (!decodedIntent) throw new Error("registered liquidity exit is missing");
    const decodedSnapshot = resultValue(snapshot);
    const decodedInfo = resultValue(info);
    return {
      ...entry,
      status: phaseName(decodedIntent.status),
      intent: {
        ...decodedIntent,
        status: phaseName(decodedIntent.status),
      },
      snapshot: decodedSnapshot,
      stateVersion: decodedInfo.state_version,
      checkedAt: new Date().toISOString(),
    };
  };

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const tree = await indexer.sync();
      runtime.outputs = tree.nextLeafIndex;
      runtime.lastIndexAt = new Date().toISOString();
      for (const proposal of proposals.list()) {
        try {
          runtime.proposals[proposal.proposalId] = {
            ...(await processProposal(proposal)),
            checkedAt: new Date().toISOString(),
          };
        } catch (error) {
          runtime.proposals[proposal.proposalId] = {
            status: "error",
            checkedAt: new Date().toISOString(),
            error: String(error?.message || error),
          };
          runtime.errors.push({
            at: new Date().toISOString(),
            proposal: proposal.proposalId,
            error: String(error?.message || error),
          });
          runtime.errors = runtime.errors.slice(-20);
        }
      }
      for (const exit of exits.list()) {
        try {
          runtime.exits[exitKey(exit)] = await readExit(exit);
        } catch (error) {
          runtime.exits[exitKey(exit)] = {
            ...exit,
            status: "Error",
            checkedAt: new Date().toISOString(),
            error: String(error?.message || error),
          };
          runtime.errors.push({
            at: new Date().toISOString(),
            exit: exit.exitId,
            error: String(error?.message || error),
          });
          runtime.errors = runtime.errors.slice(-20);
        }
      }
      for (const market of registry.list()) {
        try {
          runtime.markets[market] = {
            ...(await coordinator.process(market)),
            checkedAt: new Date().toISOString(),
          };
        } catch (error) {
          runtime.markets[market] = {
            status: "error",
            checkedAt: new Date().toISOString(),
            error: String(error?.message || error),
          };
          runtime.errors.push({
            at: new Date().toISOString(),
            market,
            error: String(error?.message || error),
          });
          runtime.errors = runtime.errors.slice(-20);
        }
      }
      runtime.lastTickAt = new Date().toISOString();
    } finally {
      ticking = false;
    }
  };

  const httpServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`,
    );
    const origin = request.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      sendJson(request, response, 403, { error: "origin is not allowed" });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, responseHeaders(request));
      response.end();
      return;
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      requestUrl.pathname.startsWith("/zk/private/")
    ) {
      const relative = decodeURIComponent(
        requestUrl.pathname.slice("/zk/private/".length),
      );
      if (artifacts.serve(request, response, relative)) return;
      sendJson(request, response, 404, { error: "artifact not found" });
      return;
    }
    try {
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const lastTick = Date.parse(runtime.lastTickAt || "");
        const healthy =
          Number.isFinite(lastTick) &&
          Date.now() - lastTick <= Math.max(60_000, TICK_MS * 4);
        sendJson(request, response, healthy ? 200 : 503, {
          healthy,
          network: "testnet",
          vault: vaultId,
          ...runtime,
        });
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === "/private/config"
      ) {
        sendJson(request, response, 200, {
          ...deployment,
          networkDomain: Buffer.from(vaultInfo.network_domain).toString("hex"),
          verifierDomain: Buffer.from(vaultInfo.verifier_domain).toString("hex"),
          artifactBase: "/zk/private",
          publicDepositBoundary: true,
          testnetSingleVmCommittee: true,
        });
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === "/private/tree"
      ) {
        sendJson(request, response, 200, await indexer.sync());
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === "/private/allocation"
      ) {
        const allocation = allocations.get(
          requestUrl.searchParams.get("market") || "",
          requestUrl.searchParams.get("epoch") || "",
          requestUrl.searchParams.get("commitment") || "",
        );
        if (!allocation) {
          sendJson(request, response, 404, {
            error: "private allocation witness is not available",
          });
          return;
        }
        sendJson(request, response, 200, allocation);
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === "/private/markets"
      ) {
        const markets = [];
        for (const market of registry.list()) {
          const registration = resultValue(
            await vault.registration({ market }),
          );
          const epoch = registration
            ? resultValue(await vault.epoch({
                market,
                epoch_number: BigInt(registration.current_epoch),
              }))
            : undefined;
          markets.push({
            market,
            registration,
            epoch: epoch
              ? { ...epoch, phase: phaseName(epoch.phase) }
              : undefined,
            service: runtime.markets[market],
          });
        }
        sendJson(request, response, 200, { markets });
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === "/private/exits"
      ) {
        const market = requestUrl.searchParams.get("market");
        const liquidityVault = requestUrl.searchParams.get("liquidityVault");
        const status = requestUrl.searchParams.get("status");
        const offset = Number(requestUrl.searchParams.get("offset") || 0);
        const limit = Number(requestUrl.searchParams.get("limit") || 100);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 200
        ) {
          throw new Error("invalid liquidity exit pagination");
        }
        const filtered = Object.values(runtime.exits).filter((entry) =>
          (!market || entry.market === market) &&
          (!liquidityVault || entry.liquidityVault === liquidityVault) &&
          (!status || entry.status === status)
        );
        sendJson(request, response, 200, {
          exits: filtered.slice(offset, offset + limit),
          total: filtered.length,
        });
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/private/register-proposal"
      ) {
        const clientKey = request.socket.remoteAddress || "unknown";
        if (!perClient.take(`proposal:${clientKey}`).allowed) {
          sendJson(request, response, 429, { error: "rate limit exceeded" });
          return;
        }
        const body = await readBody(request);
        const proposal = await proposals.register(body.proposalId);
        sendJson(request, response, 200, {
          ...proposal,
          registered: true,
        });
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/private/register-market"
      ) {
        const clientKey = request.socket.remoteAddress || "unknown";
        if (!perClient.take(`register:${clientKey}`).allowed) {
          sendJson(request, response, 429, { error: "rate limit exceeded" });
          return;
        }
        const body = await readBody(request);
        const market = await registry.register(body.market);
        sendJson(request, response, 200, { market, registered: true });
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/private/register-exit"
      ) {
        const clientKey = request.socket.remoteAddress || "unknown";
        if (!perClient.take(`exit:${clientKey}`).allowed) {
          sendJson(request, response, 429, { error: "rate limit exceeded" });
          return;
        }
        const body = await readBody(request);
        const exit = await exits.register({
          market: body.market,
          liquidityVault: body.liquidityVault,
          exitId: body.exitId,
        });
        runtime.exits[exitKey(exit)] = await readExit(exit);
        sendJson(request, response, 200, runtime.exits[exitKey(exit)]);
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/private/relay"
      ) {
        const clientKey = request.socket.remoteAddress || "unknown";
        if (
          !perClient.take(`relay:${clientKey}`).allowed ||
          !global.take("relay").allowed
        ) {
          sendJson(request, response, 429, { error: "rate limit exceeded" });
          return;
        }
        const relay = decodeRelayRequest(await readBody(request));
        const submitted = await serialize(() => submitInvocation({
          server,
          source,
          contractId: vaultId,
          method: relay.method,
          args: relay.args,
          networkPassphrase: NETWORK_PASSPHRASE,
        }));
        if (relay.method === "request_liquidity_exit") {
          const entry = {
            market: scValToNative(relay.args[0]),
            liquidityVault: scValToNative(relay.args[1]),
            exitId: Buffer.from(scValToNative(relay.args[2])).toString("hex"),
          };
          try {
            const exit = await exits.register(entry);
            runtime.exits[exitKey(exit)] = await readExit(exit);
          } catch (error) {
            submitted.exitRegistrationPending = true;
            runtime.errors.push({
              at: new Date().toISOString(),
              exit: entry.exitId,
              error: String(error?.message || error),
            });
            runtime.errors = runtime.errors.slice(-20);
          }
        }
        sendJson(request, response, 200, submitted);
        return;
      }
      sendJson(request, response, 404, { error: "not found" });
    } catch (error) {
      sendJson(request, response, 400, {
        error: String(error?.message || error),
      });
    }
  });

  await tick();
  setInterval(() => {
    tick().catch((error) => {
      runtime.errors.push({
        at: new Date().toISOString(),
        error: String(error?.message || error),
      });
      runtime.errors = runtime.errors.slice(-20);
    });
  }, TICK_MS).unref();
  httpServer.listen(PORT, "0.0.0.0", () => {
    process.stdout.write(
      `private testnet service listening on ${PORT} for vault ${vaultId}\n`,
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
  });
}
