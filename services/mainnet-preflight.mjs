import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { cfg } from "./config.mjs";
import {
  assertRpcNetwork,
  networkConfig,
} from "./network-config.mjs";
import { startRpcFailover } from "./rpc-failover.mjs";
import { reflectorConfig } from "./oracle-config.mjs";
import { PrivateArtifactStore } from "./private-artifacts.mjs";
import { RELEASE_WASM_FILES } from "./fetch-release-wasm.mjs";

export const MAINNET_USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function accountBalances(account) {
  const native = account.balances.find(
    (balance) => balance.asset_type === "native",
  );
  const usdc = account.balances.find(
    (balance) =>
      balance.asset_code === "USDC" &&
      balance.asset_issuer === MAINNET_USDC_ISSUER,
  );
  return {
    xlm: Number(native?.balance || 0),
    usdc: Number(usdc?.balance || 0),
    hasUsdcTrustline: Boolean(usdc),
  };
}

async function readContract(server, passphrase, contractId, method) {
  const source = new Account(Keypair.random().publicKey(), "0");
  const transaction = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(new Contract(contractId).call(method))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`failed to read ${contractId}.${method}`);
  }
  return scValToNative(simulation.result.retval);
}

export async function runMainnetPreflight() {
  const network = networkConfig({
    ...process.env,
    MOROS_NETWORK: "mainnet",
    NETWORK: "mainnet",
    NETWORK_PASSPHRASE: Networks.PUBLIC,
  });
  const deployerSecret = network.deployerSecret;
  if (!deployerSecret) {
    throw new Error("MOROS_MAINNET_DEPLOYER_SK is required");
  }
  if (!network.privacySecret) {
    throw new Error("MOROS_MAINNET_PRIVACY_SK is required");
  }
  const sourceCommit =
    process.env.MOROS_MAINNET_SOURCE_COMMIT ||
    process.env.MOROS_SOURCE_COMMIT ||
    "";
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error("MOROS_MAINNET_SOURCE_COMMIT is required");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: cfg.repo,
    encoding: "utf8",
  }).trim();
  if (head !== sourceCommit) {
    throw new Error("mainnet source commit does not match the checked-out commit");
  }

  const expectedUsdc = new Asset(
    "USDC",
    MAINNET_USDC_ISSUER,
  ).contractId(Networks.PUBLIC);
  assert.equal(
    network.collateralContract,
    expectedUsdc,
    "mainnet Circle USDC SAC mismatch",
  );

  const rpcUrl = await startRpcFailover(network);
  const server = new rpc.Server(rpcUrl);
  const networkInfo = await assertRpcNetwork(server, network);
  if (Number(networkInfo.protocolVersion || 0) < 26) {
    throw new Error("mainnet RPC does not support the required BN254 host functions");
  }
  const [symbol, decimals] = await Promise.all([
    readContract(
      server,
      network.passphrase,
      network.collateralContract,
      "symbol",
    ),
    readContract(
      server,
      network.passphrase,
      network.collateralContract,
      "decimals",
    ),
  ]);
  if (symbol !== "USDC" || Number(decimals) !== 7) {
    throw new Error("mainnet collateral is not Circle USDC");
  }

  const deployer = Keypair.fromSecret(deployerSecret).publicKey();
  const accountResponse = await fetch(
    `${network.horizonUrl}/accounts/${deployer}`,
  );
  if (!accountResponse.ok) {
    throw new Error(`mainnet deployer account is unavailable: HTTP ${accountResponse.status}`);
  }
  const balances = accountBalances(await accountResponse.json());
  const minimumXlm = Number(process.env.MOROS_MAINNET_MIN_XLM || "250");
  const roundingReserve = Number(
    process.env.MOROS_MAINNET_ROUNDING_RESERVE || "10000000",
  ) / 10_000_000;
  if (!balances.hasUsdcTrustline) {
    throw new Error("mainnet deployer needs a Circle USDC trustline");
  }
  if (balances.xlm < minimumXlm) {
    throw new Error(
      `mainnet deployer needs at least ${minimumXlm} XLM, found ${balances.xlm}`,
    );
  }
  if (balances.usdc < roundingReserve) {
    throw new Error(
      `mainnet deployer needs at least ${roundingReserve} USDC, found ${balances.usdc}`,
    );
  }

  const setupRoot = resolve(cfg.repo, "circuits/private-mainnet-build");
  const setupManifestPath = resolve(setupRoot, "manifest.json");
  const publicRoot = resolve(setupRoot, "public");
  if (!existsSync(setupManifestPath)) {
    throw new Error("mainnet proving package is missing");
  }
  const setupManifest = JSON.parse(readFileSync(setupManifestPath, "utf8"));
  if (
    setupManifest.network !== "mainnet" ||
    setupManifest.mainnet_ready !== true ||
    setupManifest.source_commit !== sourceCommit
  ) {
    throw new Error("mainnet proving package does not match this release");
  }
  const setupHash = sha256(readFileSync(setupManifestPath));
  new PrivateArtifactStore({
    root: publicRoot,
    deployment: {
      network: "mainnet",
      mainnetReady: true,
      provingManifestSha256: setupHash,
    },
  });

  const releaseRoot = resolve(
    cfg.repo,
    "contracts/target/wasm32v1-none/release",
  );
  const testnetDeployment = JSON.parse(
    readFileSync(
      resolve(cfg.repo, "deployments/private-testnet.json"),
      "utf8",
    ),
  );
  for (const [name, file] of Object.entries(RELEASE_WASM_FILES)) {
    const path = resolve(releaseRoot, file);
    if (
      !existsSync(path) ||
      sha256(readFileSync(path)) !== testnetDeployment.wasm?.[name]
    ) {
      throw new Error(`${name} release WASM is not the tested bytecode`);
    }
  }

  const reflector = reflectorConfig("mainnet");
  for (const contractId of [reflector.cexOracle, reflector.fiatOracle]) {
    await readContract(server, network.passphrase, contractId, "decimals");
  }

  process.stdout.write(
    `mainnet preflight ok: deployer ${deployer}, ${balances.xlm} XLM, ${balances.usdc} USDC, protocol ${networkInfo.protocolVersion}\n`,
  );
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await runMainnetPreflight();
}
