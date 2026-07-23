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
} from "@stellar/stellar-sdk";
import { cfg } from "./config.mjs";
import {
  PrivateBatchCoordinator,
  createBatchProver,
  phaseName,
} from "./private-batch-coordinator.mjs";
import { PrivateArtifactStore } from "./private-artifacts.mjs";
import { PrivateOutputIndexer } from "./private-indexer.mjs";
import { PrivateMarketRegistry } from "./private-market-registry.mjs";
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
  const indexer = new PrivateOutputIndexer({
    client: vault,
    stateFile: OUTPUT_STATE,
    vaultId,
    levels: Number(vaultInfo.levels),
  });
  await indexer.sync();

  const marketClients = new Map();
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

  const batchRoot = resolve(ARTIFACT_ROOT, "batch");
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
    errors: [],
  };
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const tree = await indexer.sync();
      runtime.outputs = tree.nextLeafIndex;
      runtime.lastIndexAt = new Date().toISOString();
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
