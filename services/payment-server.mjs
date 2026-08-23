import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, rpc, scValToNative } from "@stellar/stellar-sdk";
import { cfg } from "./config.mjs";
import { PaymentApi } from "./payment-api.mjs";
import { FilePaymentIndexStore, PaymentEventIndexer } from "./payment-indexer.mjs";
import { PaymentRelayService } from "./payment-relay.mjs";
import { createPaymentSyncService } from "./payment-sync-factory.mjs";
import { submitInvocation } from "./soroban-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PAYMENT_PORT || 8790);
const DEPLOYMENT_PATH = resolve(
  cfg.repo,
  process.env.MOROS_PAYMENT_TESTNET_DEPLOYMENT || "deployments/payments-testnet.json",
);
const LOCAL_STATE_PATH = resolve(
  cfg.repo,
  process.env.MOROS_PAYMENT_TESTNET_STATE || "deployments/payments-testnet.local.json",
);
const ARTIFACT_ROOT = resolve(
  cfg.repo,
  process.env.MOROS_PAYMENT_TESTNET_ZK_PUBLIC_DIR || "apps/pay-web/public/zk/payments",
);
const RUNTIME_ROOT = resolve(
  cfg.repo,
  process.env.MOROS_PAYMENT_TESTNET_RUNTIME_DIR || "services/payment-runtime/testnet",
);
const INDEX_INTERVAL_MS = Number(process.env.PAYMENT_INDEX_INTERVAL_MS || 4_000);
const MAX_BODY_BYTES = 1_500_000;
const MAX_STATIC_FILE_BYTES = 128 * 1024 * 1024;

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function required(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function hex(value, bytes, label) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return Buffer.from(value, "hex");
}

function paymentIdentity(value) {
  if (!value || typeof value !== "object") throw new Error("invalid payment identity");
  return {
    spendPublicKey: BigInt(value.spend_public_key),
    viewingPublicKeyX: BigInt(value.viewing_public_key_x),
    viewingPublicKeyY: BigInt(value.viewing_public_key_y),
  };
}

function eventPosition(id, ledger) {
  if (typeof id !== "string" || !/^\d+-\d+$/.test(id)) {
    throw new Error("invalid Stellar payment event identifier");
  }
  const [transactionPosition, eventPositionValue] = id.split("-");
  const transactionIndex = BigInt(transactionPosition) - BigInt(ledger) * (1n << 32n);
  const eventIndex = BigInt(eventPositionValue);
  if (
    transactionIndex < 0n ||
    transactionIndex > 1_000_000n ||
    eventIndex < 0n ||
    eventIndex > 1_000_000n
  ) {
    throw new Error("invalid Stellar payment event position");
  }
  return { txIndex: Number(transactionIndex), eventIndex: Number(eventIndex) };
}

function bytesHex(value, bytes, label) {
  const normalized = Buffer.from(value);
  if (normalized.length !== bytes) throw new Error(`invalid ${label}`);
  return normalized.toString("hex");
}

function actionCode(value) {
  const tag = Array.isArray(value) ? value[0] : value?.tag || value;
  if (tag === "Deposit") return 0;
  if (tag === "Transfer") return 1;
  if (tag === "Withdraw") return 2;
  throw new Error("invalid payment action event");
}

export function normalizePaymentRpcEvent(event, vault) {
  const contractId = typeof event.contractId === "string"
    ? event.contractId
    : event.contractId?.toString();
  if (contractId !== vault) throw new Error("payment event is from the wrong vault");
  const topic = event.topic.map(scValToNative);
  const name = topic[0];
  const actionId = bytesHex(topic[1], 32, "payment action id");
  const value = scValToNative(event.value);
  const position = eventPosition(event.id, event.ledger);
  const base = {
    cursor: event.pagingToken || event.id,
    ledger: event.ledger,
    ...position,
    txHash: required(event.txHash, "payment transaction hash"),
    contractId,
    topic: name,
    actionId,
  };
  if (name === "payment_output" && Array.isArray(value) && value.length === 4) {
    return {
      ...base,
      outputIndex: Number(value[0]),
      leafIndex: Number(value[1]),
      commitment: BigInt(value[2]).toString(),
      encryptedOutput: bytesHex(value[3], 480, "payment envelope"),
    };
  }
  if (name === "payment_attachment" && Array.isArray(value) && value.length === 2) {
    return {
      ...base,
      attachmentHash: BigInt(value[0]).toString(),
      encryptedAttachment: bytesHex(value[1], 128, "payment attachment"),
    };
  }
  if (name === "payment_action" && Array.isArray(value) && value.length === 5) {
    return {
      ...base,
      action: actionCode(value[0]),
      firstLeafIndex: Number(value[1]),
      outputCount: Number(value[2]),
      newRoot: BigInt(value[3]).toString(),
      publicAmount: BigInt(value[4]).toString(),
    };
  }
  throw new Error("unsupported payment event");
}

export class StellarPaymentEventSource {
  constructor({ server, vault }) {
    this.server = server;
    this.vault = vault;
  }

  async getEvents({ startLedger, cursor, limit }) {
    const latest = await this.server.getLatestLedger();
    const request = {
      filters: [{ type: "contract", contractIds: [this.vault] }],
      limit,
    };
    if (cursor) request.cursor = cursor;
    else request.startLedger = startLedger;
    const response = await this.server.getEvents(request);
    const events = response.events.map((event) => normalizePaymentRpcEvent(event, this.vault));
    return {
      latestLedger: latest.sequence,
      events,
      hasMore: events.length === limit,
      nextCursor: events.at(-1)?.cursor || null,
    };
  }
}

function allowedOrigins(raw) {
  const values = (raw || "https://pay.moros.fun,http://localhost:3001,http://127.0.0.1:3001")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values.map((value) => new URL(value).origin))];
}

function contentType(path) {
  const extension = extname(path);
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function artifactPath(pathname, names) {
  if (!pathname.startsWith("/zk/payments/")) return null;
  const filename = pathname.slice("/zk/payments/".length);
  if (!names.has(filename)) return null;
  const path = resolve(ARTIFACT_ROOT, filename);
  return path.startsWith(`${ARTIFACT_ROOT}/`) ? path : null;
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request is too large");
    chunks.push(chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function writeFetchResponse(response, target) {
  target.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    target.end();
    return;
  }
  for await (const chunk of response.body) target.write(chunk);
  target.end();
}

function serializeTransactions() {
  let queue = Promise.resolve();
  return (operation) => {
    const current = queue.then(operation, operation);
    queue = current.catch(() => {});
    return current;
  };
}

function requestHeaders(headers) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((entry) => result.append(name, entry));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

async function main() {
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) throw new Error("invalid payment port");
  if (!Number.isSafeInteger(INDEX_INTERVAL_MS) || INDEX_INTERVAL_MS < 1_000) {
    throw new Error("payment index interval must be at least 1000 milliseconds");
  }
  const deployment = readJson(DEPLOYMENT_PATH);
  const state = readJson(LOCAL_STATE_PATH);
  if (
    deployment.environment !== "testnet" ||
    deployment.network !== "stellar:testnet" ||
    deployment.networkPassphrase !== Networks.TESTNET ||
    state.complete !== true ||
    state.ids?.vault !== deployment.vault ||
    state.ids?.verifier !== deployment.verifier
  ) {
    throw new Error("payment testnet deployment is invalid");
  }
  const source = Keypair.fromSecret(required(
    process.env.MOROS_PAYMENT_TESTNET_FUNDER_SK || process.env.MOROS_TESTNET_DEPLOYER_SK,
    "payment testnet funder secret",
  ));
  const rpcUrl = process.env.MOROS_PAYMENT_TESTNET_RPC_URL || deployment.rpcUrls[0];
  const stellar = new rpc.Server(rpcUrl);
  if ((await stellar.getNetwork()).passphrase !== Networks.TESTNET) {
    throw new Error("payment RPC is not connected to testnet");
  }

  const artifacts = new Set(["manifest.json"]);
  for (const circuit of deployment.circuits) {
    artifacts.add(`${circuit.name}.wasm`);
    artifacts.add(`${circuit.name}.zkey`);
    artifacts.add(`${circuit.name}.vk.json`);
  }
  for (const filename of artifacts) {
    const path = resolve(ARTIFACT_ROOT, filename);
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size > MAX_STATIC_FILE_BYTES) {
      throw new Error(`invalid payment proving artifact ${filename}`);
    }
  }

  const indexer = new PaymentEventIndexer({
    source: new StellarPaymentEventSource({ server: stellar, vault: deployment.vault }),
    store: new FilePaymentIndexStore(resolve(RUNTIME_ROOT, "index.json")),
    network: deployment.network,
    vault: deployment.vault,
    startLedger: deployment.startLedger,
  });
  await indexer.sync();
  const sync = createPaymentSyncService({
    network: deployment.network,
    vault: deployment.vault,
    localStatePath: resolve(RUNTIME_ROOT, "sync.json"),
  });
  const serialize = serializeTransactions();
  const relay = new PaymentRelayService({
    vault: deployment.vault,
    token: deployment.usdcContract,
    networkDomain: hex(state.networkDomain, 32, "payment network domain"),
    signingSeed: hex(state.relaySigningSeed, 32, "payment relay signing seed"),
    paymentIdentity: paymentIdentity(state.protocolIdentity),
    fee: BigInt(process.env.MOROS_PAYMENT_TESTNET_RELAY_FEE_ATOMIC || "0"),
    submit: ({ contract, method, args }) => serialize(async () => submitInvocation({
      server: stellar,
      source,
      contractId: contract,
      method,
      args,
      networkPassphrase: Networks.TESTNET,
      timeoutSeconds: 300,
    })),
  });
  const origins = allowedOrigins(process.env.PAYMENT_PUBLIC_ORIGINS);
  const api = new PaymentApi({ relay, indexer, sync, allowedOrigins: origins });
  let indexPending = null;
  let lastIndexAttempt = 0;
  const refreshIndex = () => {
    if (indexPending) return indexPending;
    if (Date.now() - lastIndexAttempt < INDEX_INTERVAL_MS) return Promise.resolve();
    lastIndexAttempt = Date.now();
    indexPending = indexer.sync()
      .catch(() => undefined)
      .finally(() => {
        indexPending = null;
      });
    return indexPending;
  };
  const timer = setInterval(() => void refreshIndex(), INDEX_INTERVAL_MS);
  timer.unref();

  const server = http.createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const staticPath = artifactPath(url.pathname, artifacts);
      if ((request.method === "GET" || request.method === "HEAD") && staticPath) {
        const info = statSync(staticPath);
        response.writeHead(200, {
          "access-control-allow-origin": origin && origins.includes(origin) ? origin : "https://pay.moros.fun",
          "cache-control": url.pathname.endsWith("manifest.json")
            ? "public, max-age=60"
            : "public, max-age=31536000, immutable",
          "content-length": info.size,
          "content-type": contentType(staticPath),
          "x-content-type-options": "nosniff",
        });
        if (request.method === "HEAD") response.end();
        else createReadStream(staticPath).pipe(response);
        return;
      }
      if (request.method === "GET" && (
        url.pathname === "/v1/health" ||
        url.pathname === "/v1/outputs" ||
        url.pathname.startsWith("/v1/actions/") ||
        url.pathname.startsWith("/v1/attachments/")
      )) {
        void refreshIndex();
      }
      const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await requestBody(request);
      const fetchRequest = new Request(url, {
        method: request.method,
        headers: requestHeaders(request.headers),
        body,
      });
      await writeFetchResponse(await api.handle(fetchRequest), response);
    } catch (error) {
      const tooLarge = error?.message === "request is too large";
      response.writeHead(tooLarge ? 413 : 503, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(`${JSON.stringify({ error: tooLarge ? "request is too large" : "payment service temporarily unavailable" })}\n`);
    }
  });
  server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`Moros payment testnet service listening on ${PORT}\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
