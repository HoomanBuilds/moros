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
  REFLECTOR_CEX_ORACLE,
  REFLECTOR_FIAT_ORACLE,
} from "./oracle-config.mjs";

const RPC_URL =
  process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE =
  process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const SECRET = process.env.FUNDER_SK || "";
const SOURCE_COMMIT = process.env.MOROS_SOURCE_COMMIT || "";
const LABEL =
  process.env.MOROS_DEPLOYMENT_LABEL || "private-testnet-20260723";
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

const contractFiles = {
  verifier: "zk_verifier.wasm",
  resolver: "resolver.wasm",
  sharedVault: "shielded_collateral_vault.wasm",
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
    .setTimeout(120)
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
  for (let attempt = 0; attempt < 60; attempt++) {
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
    throw new Error("installed WASM hash did not match the local artifact");
  }
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
  const deployment = await contract.Client.deploy(args, {
    ...signingOptions(source),
    wasmHash: artifact.hash,
    salt,
    address: source.publicKey(),
    timeoutInSeconds: 120,
  });
  await deployment.signAndSend();
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
    if (circuit.code < info.circuits) {
      const current = (
        await client.circuit_key({ circuit: expected.circuit })
      ).result;
      if (
        canonicalJson(normalized(current)) !==
        canonicalJson(normalized(expected))
      ) {
        throw new Error(`${circuit.name} verifier key mismatch`);
      }
      continue;
    }
    const transaction = await client.add_key({
      controller: sourceAddress,
      key: expected,
    });
    await transaction.signAndSend();
    info = (await client.info()).result;
    if (info.circuits !== circuit.code + 1) {
      throw new Error(`${circuit.name} verifier key was not registered`);
    }
  }
  if (!info.finalized) {
    await (
      await client.finalize({ controller: sourceAddress })
    ).signAndSend();
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
  await (
    await client.fund_rounding_reserve({
      from: sourceAddress,
      amount,
    })
  ).signAndSend();
  const updated = (await client.info()).result;
  if (updated.rounding_reserve !== ROUNDING_RESERVE) {
    throw new Error("rounding reserve funding did not reconcile");
  }
}

async function main() {
  if (cfg.network !== "testnet" || PASSPHRASE !== Networks.TESTNET) {
    throw new Error("this deployment pipeline is testnet only");
  }
  if (!SECRET) throw new Error("FUNDER_SK is required");
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
  const sourceAddress = source.publicKey();
  const server = new rpc.Server(RPC_URL);
  const artifacts = wasmArtifacts();
  const identity = testnetPrivacyIdentity(SECRET);
  const salts = Object.fromEntries(
    ["verifier", "resolver", "sharedVault", "factory"].map((name) => [
      name,
      deterministicSalt(`${LABEL}:${name}`),
    ]),
  );
  const ids = Object.fromEntries(
    Object.entries(salts).map(([name, salt]) => [
      name,
      deriveContractId(sourceAddress, salt, PASSPHRASE),
    ]),
  );
  const state = {
    ...readState(),
    network: "testnet",
    label: LABEL,
    source: sourceAddress,
    ids,
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
  const verifierInfo = await registerVerifier(
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
    artifact: artifacts.factory,
    contractId: ids.factory,
    salt: salts.factory,
    args: {
      config: {
        governance: sourceAddress,
        collateral: COLLATERAL,
        shared_vault: ids.sharedVault,
        resolver: ids.resolver,
        network_domain: networkDomain(PASSPHRASE),
        market_wasm_hash: artifacts.market.hash,
        liquidity_wasm_hash: artifacts.liquidityVault.hash,
        allowed_assets: FREE_REFLECTOR_ASSETS,
        liquidity_tiers: [
          200_000_000n,
          500_000_000n,
          1_000_000_000n,
        ],
        minimum_funding_window: 3_600n,
        minimum_open_window: 3_600n,
        maximum_market_duration: 7_776_000n,
        batch_grace: 300n,
        epoch_duration: 120n,
        refund_delay: 120n,
        committee_epoch: 1n,
        committee_config_hash: identity.committeeConfigHash,
        committee_public_key_x: identity.committeePublicKey[0],
        committee_public_key_y: identity.committeePublicKey[1],
        maximum_fee_bps: 1_000,
        lp_fee_share_bps: 8_000,
        fixed_batch_size: 8,
        minimum_side_count: 2,
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
  const [resolverConfig, vaultInfo, factoryConfig] = await Promise.all([
    resolver.config(),
    vault.info(),
    factory.config(),
  ]);
  const resolverValue = contractResultValue(resolverConfig.result);
  if (
    vaultInfo.result.factory !== ids.factory ||
    vaultInfo.result.verifier !== ids.verifier ||
    vaultInfo.result.token !== COLLATERAL ||
    factoryConfig.result.shared_vault !== ids.sharedVault ||
    factoryConfig.result.resolver !== ids.resolver ||
    factoryConfig.result.collateral !== COLLATERAL ||
    resolverValue.quorum !== 1
  ) {
    throw new Error("deployed contract wiring did not match the manifest");
  }
  await fundRoundingReserve(vault, sourceAddress);

  const publicDeployment = {
    network: "testnet",
    label: LABEL,
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
      liquidityTiers: [
        200_000_000n,
        500_000_000n,
        1_000_000_000n,
      ],
      feeMaximumBps: 1_000,
      lpFeeShareBps: 8_000,
      fixedBatchSize: 8,
      minimumSideCount: 2,
      maximumPriceMovement: Q32 / 4n,
      minimumFundingWindow: 3_600,
      minimumOpenWindow: 3_600,
      maximumMarketDuration: 7_776_000,
    },
    mainnetReady: false,
  };
  savePublic(publicDeployment);
  saveState({ ...state, complete: true, publicDeployment });
  process.stdout.write(
    `private testnet contracts ready: factory ${ids.factory}, vault ${ids.sharedVault}\n`,
  );
}

main();
