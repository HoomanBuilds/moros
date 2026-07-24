import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  resolve,
} from "node:path";
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
import { cfg } from "./config.mjs";
import {
  CIRCUITS,
  canonicalJson,
  keyPayloadFromJson,
} from "../circuits/private/artifacts.mjs";
import {
  PRIVATE_GENESIS_ROOT,
  PRIVATE_TREE_LEVELS,
  contractResultValue,
  deriveContractId,
  deterministicSalt,
  fieldBytes,
  networkDomain,
  testnetPrivacyIdentity,
} from "./deployment-utils.mjs";
import {
  FREE_REFLECTOR_ASSETS,
  FREE_REFLECTOR_RISK_GROUPS,
  REFLECTOR_CEX_ORACLE,
  REFLECTOR_FIAT_ORACLE,
} from "./oracle-config.mjs";

const RPC_URL =
  process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE =
  process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const SECRET =
  process.env.DEPLOYER_SK || process.env.FUNDER_SK || "";
const PRIVACY_SECRET =
  process.env.MOROS_TESTNET_PRIVACY_SK ||
  process.env.FUNDER_SK ||
  SECRET;
const ROUNDING_SECRET =
  process.env.ROUNDING_FUNDER_SK || SECRET;
const SOURCE_COMMIT = process.env.MOROS_SOURCE_COMMIT || "";
const DEPLOYMENT_NAME =
  process.env.MOROS_DEPLOYMENT_NAME || "Moros Testnet";
const SALT_NAMESPACE =
  process.env.MOROS_DEPLOYMENT_SALT || "moros-testnet-release";
const COLLATERAL =
  process.env.COLLATERAL_ID ||
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const STATE_PATH = resolve(
  cfg.repo,
  process.env.MOROS_DEPLOYMENT_STATE ||
    "deployments/private-testnet.local.json",
);
const PUBLIC_PATH = resolve(
  cfg.repo,
  process.env.MOROS_PUBLIC_DEPLOYMENT ||
    "deployments/private-testnet.json",
);
const BUILD_ROOT = resolve(
  process.env.MOROS_ZK_BUILD_DIR ||
    resolve(cfg.repo, "circuits/private-build"),
);
const MANIFEST_PATH = resolve(
  process.env.MOROS_ZK_MANIFEST ||
    resolve(BUILD_ROOT, "manifest.json"),
);
const WASM_ROOT = resolve(
  cfg.repo,
  "contracts/target/wasm32v1-none/release",
);
const ROUNDING_RESERVE = BigInt(
  process.env.MOROS_ROUNDING_RESERVE || "10000000",
);
const Q32 = 1n << 32n;
const MAX_DEPLOYED_BPS = 8_000;
const MAX_MARKET_BPS = 8_000;
const MAX_GROUP_BPS = 8_000;
const MINIMUM_IDLE_BPS = 2_000;
const PRIVATE_BATCH_GRACE = 600;
const PRIVATE_EPOCH_DURATION = 60;
const PRIVATE_REFUND_DELAY = 600;
const MINIMUM_FUNDING_WINDOW = 240;
const MINIMUM_OPEN_WINDOW = 600;
const RETRYABLE_TRANSACTION =
  /pending|timed out|timeout|tx_bad_seq|try again|rate limit/i;

const contractFiles = {
  verifier: "zk_verifier.wasm",
  resolver: "resolver.wasm",
  sharedVault: "shielded_collateral_vault.wasm",
  liquidityPool: "pooled_liquidity_vault.wasm",
  factory: "market_factory.wasm",
  market: "lmsr_market.wasm",
  liquidityVault: "market_liquidity_vault.wasm",
};

function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  return value;
}

function readState() {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function saveState(value) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(jsonValue(value), null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, STATE_PATH);
}

function savePublic(value) {
  mkdirSync(dirname(PUBLIC_PATH), { recursive: true });
  const temporary = `${PUBLIC_PATH}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(jsonValue(value), null, 2)}\n`);
  renameSync(temporary, PUBLIC_PATH);
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

async function sendIdempotent(name, build, isComplete) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await isComplete()) return;
    try {
      await (await build()).signAndSend();
    } catch (error) {
      if (!RETRYABLE_TRANSACTION.test(String(error?.message || error))) {
        throw error;
      }
      lastError = error;
    }
    if (await isComplete()) return;
  }
  throw new Error(`${name} did not reach its expected on-chain state`, {
    cause: lastError,
  });
}

function wasmArtifacts() {
  return Object.fromEntries(
    Object.entries(contractFiles).map(([name, file]) => {
      const path = resolve(WASM_ROOT, file);
      if (!existsSync(path)) {
        throw new Error(`missing ${path}; run stellar contract build first`);
      }
      const wasm = readFileSync(path);
      return [
        name,
        {
          path,
          wasm,
          hash: sha256(wasm),
        },
      ];
    }),
  );
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
      return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: source.publicKey(),
      };
    },
  };
}

async function submitOperation(server, source, operation) {
  const account = await server.getAccount(source.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 100_000).toString(),
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
  if (sent.status === "ERROR") {
    throw new Error("transaction submission was rejected");
  }
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((done) => setTimeout(done, 2_000));
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") {
      return {
        hash: sent.hash,
        result: scValToNative(result.returnValue),
      };
    }
    if (result.status === "FAILED") {
      throw new Error(`transaction ${sent.hash} failed`);
    }
  }
  throw new Error(`transaction ${sent.hash} timed out`);
}

async function installWasm(server, source, artifact) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const installed = await server.getContractWasmByHash(artifact.hash);
      if (sha256(installed).equals(artifact.hash)) return;
    } catch {}
    try {
      const uploaded = await submitOperation(
        server,
        source,
        Operation.uploadContractWasm({ wasm: artifact.wasm }),
      );
      if (!Buffer.from(uploaded.result).equals(artifact.hash)) {
        throw new Error("installed WASM hash did not match the local artifact");
      }
      return;
    } catch (error) {
      if (!RETRYABLE_TRANSACTION.test(String(error?.message || error))) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error("WASM upload did not reach its expected on-chain state", {
    cause: lastError,
  });
}

async function assertContractWasm(server, contractId, expectedHash) {
  try {
    const wasm = await server.getContractWasmByContractId(contractId);
    if (!sha256(wasm).equals(expectedHash)) {
      throw new Error(`${contractId} uses an unexpected WASM hash`);
    }
    return true;
  } catch (error) {
    if (String(error?.message || error).includes("unexpected WASM")) {
      throw error;
    }
    return false;
  }
}

async function deployContract({
  server,
  source,
  artifact,
  contractId,
  salt,
  args,
}) {
  if (await assertContractWasm(server, contractId, artifact.hash)) {
    return contractId;
  }
  await sendIdempotent(
    `contract deployment ${contractId}`,
    async () =>
      contract.Client.deploy(args, {
        ...signingOptions(source),
        wasmHash: artifact.hash,
        salt,
        address: source.publicKey(),
        timeoutInSeconds: 300,
      }),
    () => assertContractWasm(server, contractId, artifact.hash),
  );
  if (!(await assertContractWasm(server, contractId, artifact.hash))) {
    throw new Error(`deployment did not create ${contractId}`);
  }
  return contractId;
}

async function clientFor(artifact, contractId, source) {
  return contract.Client.fromWasm(artifact.wasm, {
    ...signingOptions(source),
    contractId,
  });
}

function normalized(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalized(entry)]),
    );
  }
  return value;
}

async function registerVerifier(client, manifest, sourceAddress) {
  let info = (await client.info()).result;
  for (const circuit of CIRCUITS) {
    const entry = manifest.circuits.find(
      (candidate) =>
        candidate.name === circuit.name && candidate.code === circuit.code,
    );
    if (!entry) throw new Error(`manifest is missing ${circuit.name}`);
    const expected = keyPayloadFromJson(
      JSON.parse(
        readFileSync(resolve(BUILD_ROOT, entry.artifacts.contract_key), "utf8"),
      ),
    );
    const hasExpectedKey = async () => {
      const currentInfo = (await client.info()).result;
      if (currentInfo.circuits <= circuit.code) return false;
      const current = (
        await client.circuit_key({ circuit: expected.circuit })
      ).result;
      if (
        canonicalJson(normalized(current)) !==
        canonicalJson(normalized(expected))
      ) {
        throw new Error(`${circuit.name} verifier key mismatch`);
      }
      return true;
    };
    if (circuit.code < info.circuits) {
      await hasExpectedKey();
      continue;
    }
    await sendIdempotent(
      `${circuit.name} verifier key registration`,
      () =>
        client.add_key(
          {
            controller: sourceAddress,
            key: expected,
          },
          { timeoutInSeconds: 300 },
        ),
      hasExpectedKey,
    );
    info = (await client.info()).result;
    if (info.circuits !== circuit.code + 1) {
      throw new Error(`${circuit.name} verifier key was not registered`);
    }
  }
  if (!info.finalized) {
    await sendIdempotent(
      "verifier finalization",
      () =>
        client.finalize(
          { controller: sourceAddress },
          { timeoutInSeconds: 300 },
        ),
      async () => (await client.info()).result.finalized,
    );
  }
  const finalInfo = (await client.info()).result;
  if (
    !finalInfo.finalized ||
    finalInfo.circuits !== CIRCUITS.length ||
    finalInfo.required_circuits !== CIRCUITS.length
  ) {
    throw new Error("verifier did not finalize with every required circuit");
  }
  return finalInfo;
}

async function fundRoundingReserve(client, sourceAddress) {
  if (ROUNDING_RESERVE <= 0n) return;
  const info = (await client.info()).result;
  if (info.rounding_reserve >= ROUNDING_RESERVE) return;
  const amount = ROUNDING_RESERVE - info.rounding_reserve;
  await sendIdempotent(
    "rounding reserve funding",
    () =>
      client.fund_rounding_reserve(
        {
          from: sourceAddress,
          amount,
        },
        { timeoutInSeconds: 300 },
      ),
    async () =>
      (await client.info()).result.rounding_reserve >= ROUNDING_RESERVE,
  );
  const updated = (await client.info()).result;
  if (updated.rounding_reserve !== ROUNDING_RESERVE) {
    throw new Error("rounding reserve funding did not reconcile");
  }
}

async function main() {
  if (cfg.network !== "testnet" || PASSPHRASE !== Networks.TESTNET) {
    throw new Error("this deployment pipeline is testnet only");
  }
  if (!SECRET) throw new Error("DEPLOYER_SK or FUNDER_SK is required");
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("private proving manifest is missing");
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (
    manifest.network !== "testnet" ||
    manifest.mainnet_ready !== false ||
    manifest.circuits?.length !== CIRCUITS.length
  ) {
    throw new Error("invalid private testnet proving manifest");
  }
  const source = Keypair.fromSecret(SECRET);
  const roundingSource = Keypair.fromSecret(ROUNDING_SECRET);
  const sourceAddress = source.publicKey();
  const server = new rpc.Server(RPC_URL);
  const artifacts = wasmArtifacts();
  const identity = testnetPrivacyIdentity(PRIVACY_SECRET);
  const salts = Object.fromEntries(
    ["verifier", "resolver", "sharedVault", "liquidityPool", "factory"].map((name) => [
      name,
      deterministicSalt(`${SALT_NAMESPACE}:${name}`),
    ]),
  );
  const ids = Object.fromEntries(
    Object.entries(salts).map(([name, salt]) => [
      name,
      deriveContractId(sourceAddress, salt, PASSPHRASE),
    ]),
  );
  const previousState = readState();
  const sameDeployment =
    previousState.network === "testnet" &&
    previousState.source === sourceAddress &&
    previousState.saltNamespace === SALT_NAMESPACE &&
    canonicalJson(previousState.ids) === canonicalJson(ids);
  const state = {
    ...(sameDeployment && previousState.wasm
      ? { wasm: previousState.wasm }
      : {}),
    ...(sameDeployment && previousState.verifierDomain
      ? { verifierDomain: previousState.verifierDomain }
      : {}),
    network: "testnet",
    name: DEPLOYMENT_NAME,
    saltNamespace: SALT_NAMESPACE,
    source: sourceAddress,
    ids,
    complete: false,
  };
  saveState(state);

  for (const artifact of Object.values(artifacts)) {
    await installWasm(server, source, artifact);
  }
  state.wasm = Object.fromEntries(
    Object.entries(artifacts).map(([name, artifact]) => [
      name,
      artifact.hash.toString("hex"),
    ]),
  );
  saveState(state);

  await deployContract({
    server,
    source,
    artifact: artifacts.verifier,
    contractId: ids.verifier,
    salt: salts.verifier,
    args: { controller: sourceAddress },
  });
  const verifier = await clientFor(
    artifacts.verifier,
    ids.verifier,
    source,
  );
  const currentVerifierInfo = (await verifier.info()).result;
  const currentVerifierDomain =
    Buffer.from(currentVerifierInfo.domain).toString("hex");
  const verifierInfo =
    state.verifierDomain === currentVerifierDomain
      && currentVerifierInfo.finalized
      && currentVerifierInfo.circuits === CIRCUITS.length
      && currentVerifierInfo.required_circuits === CIRCUITS.length
      ? currentVerifierInfo
      : await registerVerifier(
          verifier,
          manifest,
          sourceAddress,
        );
  state.verifierDomain = Buffer.from(verifierInfo.domain).toString("hex");
  saveState(state);

  await deployContract({
    server,
    source,
    artifact: artifacts.resolver,
    contractId: ids.resolver,
    salt: salts.resolver,
    args: {
      oracles: [REFLECTOR_CEX_ORACLE, REFLECTOR_FIAT_ORACLE],
      quorum: 1,
      max_age: 3_600n,
      resolution_timeout: 86_400n,
      max_deviation_bps: 500,
      max_confidence_bps: 500,
      pyth_verifier: undefined,
      pyth_feeds: [],
    },
  });

  await deployContract({
    server,
    source,
    artifact: artifacts.sharedVault,
    contractId: ids.sharedVault,
    salt: salts.sharedVault,
    args: {
      token: COLLATERAL,
      factory: ids.factory,
      governance: sourceAddress,
      verifier: ids.verifier,
      network_domain: networkDomain(PASSPHRASE),
      verifier_domain: Buffer.from(verifierInfo.domain),
      treasury_key: fieldBytes(identity.treasuryKey),
      genesis_root: PRIVATE_GENESIS_ROOT,
      levels: PRIVATE_TREE_LEVELS,
      root_history_size: 64,
      max_root_age: 2_048,
    },
  });

  await deployContract({
    server,
    source,
    artifact: artifacts.liquidityPool,
    contractId: ids.liquidityPool,
    salt: salts.liquidityPool,
    args: {
      token: COLLATERAL,
      factory: ids.factory,
      shared_vault: ids.sharedVault,
      governance: sourceAddress,
      policy: {
        deposit_cap: 1_000_000_000_000n,
        max_active_allocations: 8,
        max_deployed_bps: MAX_DEPLOYED_BPS,
        max_market_bps: MAX_MARKET_BPS,
        max_group_bps: MAX_GROUP_BPS,
        minimum_idle_bps: MINIMUM_IDLE_BPS,
        withdrawal_window: 3_600n,
        max_withdrawal_bps: 1_000,
      },
    },
  });

  await deployContract({
    server,
    source,
    artifact: artifacts.factory,
    contractId: ids.factory,
    salt: salts.factory,
    args: {
      config: {
        governance: sourceAddress,
        collateral: COLLATERAL,
        shared_vault: ids.sharedVault,
        liquidity_pool: ids.liquidityPool,
        resolver: ids.resolver,
        network_domain: networkDomain(PASSPHRASE),
        market_wasm_hash: artifacts.market.hash,
        liquidity_wasm_hash: artifacts.liquidityVault.hash,
        allowed_assets: FREE_REFLECTOR_ASSETS,
        asset_risk_groups: FREE_REFLECTOR_RISK_GROUPS,
        liquidity_tiers: [
          200_000_000n,
          500_000_000n,
          1_000_000_000n,
        ],
        minimum_funding_window: BigInt(MINIMUM_FUNDING_WINDOW),
        minimum_open_window: BigInt(MINIMUM_OPEN_WINDOW),
        maximum_market_duration: 7_776_000n,
        batch_grace: BigInt(PRIVATE_BATCH_GRACE),
        epoch_duration: BigInt(PRIVATE_EPOCH_DURATION),
        refund_delay: BigInt(PRIVATE_REFUND_DELAY),
        committee_epoch: 1n,
        committee_config_hash: identity.committeeConfigHash,
        committee_public_key_x: identity.committeePublicKey[0],
        committee_public_key_y: identity.committeePublicKey[1],
        maximum_fee_bps: 1_000,
        lp_fee_share_bps: 8_000,
        maximum_batch_size: 8,
        minimum_side_count: 0,
        maximum_price_movement: Q32 / 4n,
      },
    },
  });

  const resolver = await clientFor(
    artifacts.resolver,
    ids.resolver,
    source,
  );
  const vault = await clientFor(
    artifacts.sharedVault,
    ids.sharedVault,
    source,
  );
  const factory = await clientFor(
    artifacts.factory,
    ids.factory,
    source,
  );
  const liquidityPool = await clientFor(
    artifacts.liquidityPool,
    ids.liquidityPool,
    source,
  );
  const [resolverConfig, vaultInfo, poolInfo, factoryConfig] = await Promise.all([
    resolver.config(),
    vault.info(),
    liquidityPool.info(),
    factory.config(),
  ]);
  const resolverValue = contractResultValue(resolverConfig.result);
  if (
    vaultInfo.result.factory !== ids.factory ||
    vaultInfo.result.verifier !== ids.verifier ||
    vaultInfo.result.token !== COLLATERAL ||
    poolInfo.result.factory !== ids.factory ||
    poolInfo.result.shared_vault !== ids.sharedVault ||
    poolInfo.result.token !== COLLATERAL ||
    factoryConfig.result.shared_vault !== ids.sharedVault ||
    factoryConfig.result.liquidity_pool !== ids.liquidityPool ||
    factoryConfig.result.resolver !== ids.resolver ||
    factoryConfig.result.collateral !== COLLATERAL ||
    resolverValue.quorum !== 1
  ) {
    throw new Error("deployed contract wiring did not match the manifest");
  }
  const reserveVault =
    roundingSource.publicKey() === sourceAddress
      ? vault
      : await clientFor(
          artifacts.sharedVault,
          ids.sharedVault,
          roundingSource,
        );
  await fundRoundingReserve(
    reserveVault,
    roundingSource.publicKey(),
  );

  const publicDeployment = {
    network: "testnet",
    name: DEPLOYMENT_NAME,
    sourceCommit: SOURCE_COMMIT || manifest.source_commit,
    deployedBy: sourceAddress,
    collateral: {
      code: "USDC",
      contract: COLLATERAL,
      decimals: 7,
    },
    contracts: {
      verifier: ids.verifier,
      resolver: ids.resolver,
      sharedVault: ids.sharedVault,
      liquidityPool: ids.liquidityPool,
      factory: ids.factory,
    },
    wasm: state.wasm,
    networkDomain: networkDomain(PASSPHRASE).toString("hex"),
    verifierDomain: state.verifierDomain,
    provingManifestSha256: sha256(
      readFileSync(MANIFEST_PATH),
    ).toString("hex"),
    privacy: {
      treeLevels: PRIVATE_TREE_LEVELS,
      genesisRoot: PRIVATE_GENESIS_ROOT,
      rootHistorySize: 64,
      maxRootAge: 2_048,
      committeeEpoch: 1,
      committeeConfigHash: identity.committeeConfigHash,
      committeePublicKeyX: identity.committeePublicKey[0],
      committeePublicKeyY: identity.committeePublicKey[1],
      treasuryKey: identity.treasuryKey,
      testnetSingleVmCommittee: true,
    },
    marketPolicy: {
      allowedAssets: FREE_REFLECTOR_ASSETS,
      assetRiskGroups: FREE_REFLECTOR_RISK_GROUPS,
      liquidityTiers: [
        200_000_000n,
        500_000_000n,
        1_000_000_000n,
      ],
      feeMaximumBps: 1_000,
      lpFeeShareBps: 8_000,
      maximumBatchSize: 8,
      minimumSideCount: 0,
      maximumPriceMovement: Q32 / 4n,
      batchGrace: PRIVATE_BATCH_GRACE,
      epochDuration: PRIVATE_EPOCH_DURATION,
      refundDelay: PRIVATE_REFUND_DELAY,
      minimumFundingWindow: MINIMUM_FUNDING_WINDOW,
      minimumOpenWindow: MINIMUM_OPEN_WINDOW,
      maximumMarketDuration: 7_776_000,
    },
    liquidityPolicy: {
      depositCap: 1_000_000_000_000n,
      maxActiveAllocations: 8,
      maxDeployedBps: MAX_DEPLOYED_BPS,
      maxMarketBps: MAX_MARKET_BPS,
      maxGroupBps: MAX_GROUP_BPS,
      minimumIdleBps: MINIMUM_IDLE_BPS,
      withdrawalWindow: 3_600,
      maxWithdrawalBps: 1_000,
    },
    mainnetReady: false,
  };
  savePublic(publicDeployment);
  saveState({ ...state, complete: true, publicDeployment });
  process.stdout.write(
    `private testnet contracts ready: factory ${ids.factory}, vault ${ids.sharedVault}, pool ${ids.liquidityPool}\n`,
  );
}

main();
