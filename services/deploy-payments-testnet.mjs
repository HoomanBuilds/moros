import { createHash, createHmac, createPrivateKey, createPublicKey } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  contract,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import { cfg } from "./config.mjs";
import { publicKey } from "./committee/bn254-babyjub.mjs";
import {
  canonicalJson,
  keyPayloadFromJson,
} from "../circuits/private/artifacts.mjs";
import { PAYMENT_CIRCUITS } from "../circuits/payments/artifacts.mjs";
import {
  deriveContractId,
  deterministicSalt,
  networkDomain,
  secretScalar,
} from "./deployment-utils.mjs";
import { configuredSecret } from "./key-config.mjs";

const NETWORK = "testnet";
const PASSPHRASE = Networks.TESTNET;
const RPC_URL = process.env.MOROS_TESTNET_RPC_URL || "https://soroban-testnet.stellar.org";
const HORIZON_URL = process.env.MOROS_TESTNET_HORIZON_URL || "https://horizon-testnet.stellar.org";
const USDC_CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TREE_LEVELS = 20;
const ROOT_HISTORY_SIZE = 64;
const MAXIMUM_RELAY_FEE = "10000";
const SALT_NAMESPACE = process.env.MOROS_TESTNET_PAYMENT_SALT || "moros-payments-testnet";
const ARTIFACT_BASE_URL =
  process.env.MOROS_TESTNET_PAYMENT_ARTIFACT_URL || "https://pay.moros.fun/zk/payments";
const API_URL =
  process.env.MOROS_TESTNET_PAYMENT_API_URL || "https://pay-testnet.moros.fun";
const STATE_PATH = resolve(cfg.repo, "deployments/payments-testnet.local.json");
const PUBLIC_PATH = resolve(cfg.repo, "deployments/payments-testnet.json");
const BUILD_ROOT = resolve(cfg.repo, "circuits/payments-build");
const MANIFEST_PATH = resolve(BUILD_ROOT, "manifest.json");
const WASM_ROOT = resolve(cfg.repo, "contracts/target/wasm32v1-none/release");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const RETRYABLE = /pending|timed out|timeout|tx_bad_seq|try again|rate limit/i;

const SECRET = configuredSecret({
  secret: process.env.MOROS_TESTNET_DEPLOYER_SK || "",
  identity: process.env.MOROS_TESTNET_DEPLOYER_IDENTITY || "moros-testnet-deployer",
  label: "testnet payment deployer",
});

function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  }
  return value;
}

function save(path, value, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(jsonValue(value), null, 2)}\n`, { mode });
  renameSync(temporary, path);
}

function readState() {
  return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
}

function readPublicDeployment() {
  return existsSync(PUBLIC_PATH) ? JSON.parse(readFileSync(PUBLIC_PATH, "utf8")) : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function relaySeed(secret) {
  return createHmac("sha256", Buffer.from(secret))
    .update("moros/payments/testnet/relay-signing/v1")
    .digest();
}

function relayPublicKey(seed) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" })).subarray(-32);
}

function paymentIdentity(secret) {
  const spendSecret = secretScalar(secret, "payments-testnet-protocol-spend");
  const viewingSecret = secretScalar(secret, "payments-testnet-protocol-view");
  const viewing = publicKey(viewingSecret);
  return {
    spend_public_key: poseidon2Hash([1002n, spendSecret]),
    viewing_public_key_x: viewing[0],
    viewing_public_key_y: viewing[1],
  };
}

function signingOptions(source) {
  return {
    publicKey: source.publicKey(),
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    signTransaction: async (transactionXdr, options = {}) => {
      const transaction = TransactionBuilder.fromXDR(
        transactionXdr,
        options.networkPassphrase || PASSPHRASE,
      );
      transaction.sign(source);
      return { signedTxXdr: transaction.toXDR(), signerAddress: source.publicKey() };
    },
  };
}

function transactionHash(result) {
  return result?.sendTransactionResponse?.hash || result?.hash || "";
}

async function submitOperation(server, source, operation) {
  const account = await server.getAccount(source.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 10).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`simulation failed: ${simulation.error}`);
  }
  const prepared = rpc.assembleTransaction(transaction, simulation).build();
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error("transaction submission was rejected");
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((done) => setTimeout(done, 2_000));
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") {
      return { hash: sent.hash, result: scValToNative(result.returnValue) };
    }
    if (result.status === "FAILED") throw new Error(`transaction ${sent.hash} failed`);
  }
  throw new Error(`transaction ${sent.hash} timed out`);
}

async function sendIdempotent(name, build, complete, record) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await complete()) return;
    try {
      const result = await (await build()).signAndSend();
      const hash = transactionHash(result);
      if (hash) record(name, hash);
    } catch (error) {
      if (!RETRYABLE.test(String(error?.message || error))) throw error;
      lastError = error;
    }
    if (await complete()) return;
  }
  throw new Error(`${name} did not reach its expected state`, { cause: lastError });
}

function wasmArtifacts() {
  return Object.fromEntries([
    ["verifier", "payment_verifier.wasm"],
    ["vault", "payment_vault.wasm"],
  ].map(([name, file]) => {
    const path = resolve(WASM_ROOT, file);
    if (!existsSync(path)) throw new Error(`missing payment WASM: ${path}`);
    const wasm = readFileSync(path);
    return [name, { path, wasm, hash: sha256(wasm) }];
  }));
}

async function installWasm(server, source, name, artifact, record) {
  try {
    const installed = await server.getContractWasmByHash(artifact.hash);
    if (sha256(installed).equals(artifact.hash)) return;
  } catch {}
  const uploaded = await submitOperation(
    server,
    source,
    Operation.uploadContractWasm({ wasm: artifact.wasm }),
  );
  if (!Buffer.from(uploaded.result).equals(artifact.hash)) {
    throw new Error(`${name} uploaded WASM hash mismatch`);
  }
  record(`${name} WASM upload`, uploaded.hash);
}

async function contractMatches(server, id, expectedHash) {
  try {
    return sha256(await server.getContractWasmByContractId(id)).equals(expectedHash);
  } catch {
    return false;
  }
}

async function deployContract({ server, source, name, artifact, id, salt, args, record }) {
  if (await contractMatches(server, id, artifact.hash)) return;
  await sendIdempotent(
    `${name} deployment`,
    () => contract.Client.deploy(args, {
      ...signingOptions(source),
      wasmHash: artifact.hash,
      salt,
      address: source.publicKey(),
      timeoutInSeconds: 300,
    }),
    () => contractMatches(server, id, artifact.hash),
    record,
  );
}

async function clientFor(artifact, contractId, source) {
  return contract.Client.fromWasm(artifact.wasm, {
    ...signingOptions(source),
    contractId,
  });
}

function normalized(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalized(entry)]));
  }
  return value;
}

async function registerVerifier(client, manifest, sourceAddress, record) {
  let info = (await client.info()).result;
  for (const circuit of PAYMENT_CIRCUITS) {
    const entry = manifest.circuits.find((candidate) => candidate.name === circuit.name);
    if (!entry || entry.code !== circuit.code) throw new Error(`missing ${circuit.name} proving key`);
    const expected = keyPayloadFromJson(
      JSON.parse(readFileSync(resolve(BUILD_ROOT, entry.artifacts.contract_key), "utf8")),
    );
    const hasExpectedKey = async () => {
      const currentInfo = (await client.info()).result;
      if (Number(currentInfo.circuits) <= circuit.code) return false;
      const current = (await client.circuit_key({ circuit: expected.circuit })).result;
      if (canonicalJson(normalized(current)) !== canonicalJson(normalized(expected))) {
        throw new Error(`${circuit.name} on-chain verifier key mismatch`);
      }
      return true;
    };
    await sendIdempotent(
      `${circuit.name} verifier key`,
      () => client.add_key(
        { controller: sourceAddress, key: expected },
        { timeoutInSeconds: 300 },
      ),
      hasExpectedKey,
      record,
    );
    info = (await client.info()).result;
  }
  await sendIdempotent(
    "payment verifier finalization",
    () => client.finalize({ controller: sourceAddress }, { timeoutInSeconds: 300 }),
    async () => Boolean((await client.info()).result.finalized),
    record,
  );
  info = (await client.info()).result;
  if (!info.finalized || Number(info.circuits) !== PAYMENT_CIRCUITS.length) {
    throw new Error("payment verifier did not finalize with seven circuits");
  }
  return info;
}

async function main() {
  if (!SECRET) throw new Error("testnet payment deployer identity is required");
  if (!existsSync(MANIFEST_PATH)) throw new Error("payment proving manifest is missing");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.environment !== "testnet" || manifest.circuits?.length !== PAYMENT_CIRCUITS.length) {
    throw new Error("invalid testnet payment proving manifest");
  }
  const source = Keypair.fromSecret(SECRET);
  const server = new rpc.Server(RPC_URL);
  const actualNetwork = await server.getNetwork();
  if (actualNetwork.passphrase !== PASSPHRASE) throw new Error("payment RPC is not Stellar testnet");
  const artifacts = wasmArtifacts();
  const salts = {
    verifier: deterministicSalt(`${SALT_NAMESPACE}:verifier`, NETWORK),
    vault: deterministicSalt(`${SALT_NAMESPACE}:vault`, NETWORK),
  };
  const ids = {
    verifier: deriveContractId(source.publicKey(), salts.verifier, PASSPHRASE),
    vault: deriveContractId(source.publicKey(), salts.vault, PASSPHRASE),
  };
  const prior = readState();
  const priorPublic = readPublicDeployment();
  const state = {
    network: NETWORK,
    source: source.publicKey(),
    saltNamespace: SALT_NAMESPACE,
    ids,
    transactions: Array.isArray(prior.transactions) ? prior.transactions : [],
    complete: false,
  };
  const record = (operation, hash) => {
    if (!state.transactions.some((entry) => entry.hash === hash)) {
      state.transactions.push({ operation, hash });
      save(STATE_PATH, state, 0o600);
    }
  };
  save(STATE_PATH, state, 0o600);
  for (const [name, artifact] of Object.entries(artifacts)) {
    await installWasm(server, source, name, artifact, record);
  }
  state.wasm = Object.fromEntries(
    Object.entries(artifacts).map(([name, artifact]) => [name, artifact.hash.toString("hex")]),
  );
  save(STATE_PATH, state, 0o600);

  await deployContract({
    server,
    source,
    name: "payment verifier",
    artifact: artifacts.verifier,
    id: ids.verifier,
    salt: salts.verifier,
    args: { controller: source.publicKey() },
    record,
  });
  const verifier = await clientFor(artifacts.verifier, ids.verifier, source);
  const verifierInfo = await registerVerifier(verifier, manifest, source.publicKey(), record);

  const signingSeed = relaySeed(SECRET);
  const signingKey = relayPublicKey(signingSeed);
  const protocolIdentity = paymentIdentity(SECRET);
  const vaultAlreadyDeployed = await contractMatches(server, ids.vault, artifacts.vault.hash);
  await deployContract({
    server,
    source,
    name: "payment vault",
    artifact: artifacts.vault,
    id: ids.vault,
    salt: salts.vault,
    args: {
      admin: source.publicKey(),
      token: USDC_CONTRACT,
      verifier: ids.verifier,
      network_domain: networkDomain(PASSPHRASE),
      tree_levels: TREE_LEVELS,
      root_history_size: ROOT_HISTORY_SIZE,
      protocol_identity: protocolIdentity,
      relay_keys: [signingKey],
    },
    record,
  });
  const vault = await clientFor(artifacts.vault, ids.vault, source);
  const vaultInfo = (await vault.info()).result;
  if (
    vaultInfo.token !== USDC_CONTRACT ||
    vaultInfo.verifier !== ids.verifier ||
    Number(vaultInfo.tree_levels) !== TREE_LEVELS ||
    Number(vaultInfo.root_history_size) !== ROOT_HISTORY_SIZE ||
    Number(vaultInfo.relay_count) !== 1 ||
    BigInt(vaultInfo.liabilities) < 0n ||
    (!vaultAlreadyDeployed && BigInt(vaultInfo.liabilities) !== 0n) ||
    vaultInfo.paused
  ) {
    throw new Error("deployed payment vault wiring mismatch");
  }
  const latest = await server.getLatestLedger();
  const priorStartLedger =
    prior.startLedger ||
    (priorPublic?.vault === ids.vault && priorPublic?.verifier === ids.verifier
      ? priorPublic.startLedger
      : null);
  const publicDeployment = {
    format: 1,
    environment: "testnet",
    network: "stellar:testnet",
    networkPassphrase: PASSPHRASE,
    rpcUrls: [RPC_URL],
    apiUrls: [API_URL],
    horizonUrl: HORIZON_URL,
    vault: ids.vault,
    verifier: ids.verifier,
    usdcContract: USDC_CONTRACT,
    usdcIssuer: USDC_ISSUER,
    usdcCode: "USDC",
    treeLevels: TREE_LEVELS,
    rootHistorySize: ROOT_HISTORY_SIZE,
    startLedger: Number(priorStartLedger || latest.sequence),
    maximumRelayFeeAtomic: MAXIMUM_RELAY_FEE,
    circuits: manifest.circuits.map((entry) => ({
      name: entry.name,
      wasmUrl: `${ARTIFACT_BASE_URL}/${entry.name}.wasm`,
      provingKeyUrl: `${ARTIFACT_BASE_URL}/${entry.name}.zkey`,
      schemaHash: entry.schema_sha256,
      verificationKeyHash: entry.verification_key_sha256,
    })),
  };
  state.verifierDomain = Buffer.from(verifierInfo.domain).toString("hex");
  state.networkDomain = networkDomain(PASSPHRASE).toString("hex");
  state.relaySigningSeed = signingSeed.toString("hex");
  state.relaySigningKey = signingKey.toString("hex");
  state.protocolIdentity = protocolIdentity;
  state.startLedger = publicDeployment.startLedger;
  state.complete = true;
  save(STATE_PATH, state, 0o600);
  save(PUBLIC_PATH, publicDeployment, 0o644);
  process.stdout.write(`${JSON.stringify({
    verifier: ids.verifier,
    vault: ids.vault,
    startLedger: publicDeployment.startLedger,
    transactions: state.transactions,
  }, null, 2)}\n`);
}

await main();
