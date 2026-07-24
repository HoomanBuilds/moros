import { Networks, rpc } from "@stellar/stellar-sdk";

const PROFILES = {
  testnet: {
    id: "testnet",
    label: "Stellar testnet",
    passphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    deploymentPath: "deployments/private-testnet.json",
    artifactPath: "circuits/private-build/public",
    collateralContract:
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    mainnetReady: false,
  },
  mainnet: {
    id: "mainnet",
    label: "Stellar mainnet",
    passphrase: Networks.PUBLIC,
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    deploymentPath: "deployments/private-mainnet.json",
    artifactPath: "circuits/private-mainnet-build/public",
    collateralContract:
      "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    mainnetReady: true,
  },
};

function scoped(env, network, suffix) {
  return env[`MOROS_${network.toUpperCase()}_${suffix}`] || "";
}

export function networkConfig(env = process.env) {
  const id = env.MOROS_NETWORK || env.NETWORK || "testnet";
  const profile = PROFILES[id];
  if (!profile) {
    throw new Error("MOROS_NETWORK must be testnet or mainnet");
  }
  const passphrase = env.NETWORK_PASSPHRASE || profile.passphrase;
  if (passphrase !== profile.passphrase) {
    throw new Error(`${id} network passphrase does not match MOROS_NETWORK`);
  }
  const allowLegacy = id === "testnet";
  const rpcUrl =
    scoped(env, id, "RPC_URL") ||
    (allowLegacy ? env.RPC_URL : "") ||
    profile.rpcUrl;
  const rpcFallbackUrl = scoped(env, id, "RPC_FALLBACK_URL");
  return {
    ...profile,
    rpcUrl,
    rpcUrls: [
      ...new Set([rpcUrl, rpcFallbackUrl, profile.rpcUrl].filter(Boolean)),
    ],
    horizonUrl:
      scoped(env, id, "HORIZON_URL") ||
      (allowLegacy ? env.HORIZON_URL : "") ||
      profile.horizonUrl,
    deploymentPath:
      scoped(env, id, "DEPLOYMENT") ||
      (allowLegacy ? env.MOROS_PUBLIC_DEPLOYMENT : "") ||
      profile.deploymentPath,
    artifactPath:
      scoped(env, id, "ZK_PUBLIC_DIR") ||
      (allowLegacy ? env.MOROS_ZK_PUBLIC_DIR : "") ||
      profile.artifactPath,
    deployerSecret:
      scoped(env, id, "DEPLOYER_SK") ||
      (allowLegacy ? env.DEPLOYER_SK : "") ||
      "",
    funderSecret:
      scoped(env, id, "FUNDER_SK") ||
      (allowLegacy ? env.FUNDER_SK : "") ||
      "",
    roundingFunderSecret:
      scoped(env, id, "ROUNDING_FUNDER_SK") ||
      (allowLegacy ? env.ROUNDING_FUNDER_SK : "") ||
      "",
    privacySecret:
      scoped(env, id, "PRIVACY_SK") ||
      (allowLegacy ? env.MOROS_PRIVACY_SK : "") ||
      "",
  };
}

export function assertDeploymentNetwork(deployment, network) {
  if (
    !deployment ||
    deployment.network !== network.id ||
    deployment.mainnetReady !== network.mainnetReady
  ) {
    throw new Error(
      `deployment manifest is not ready for ${network.id}`,
    );
  }
  return deployment;
}

export async function assertRpcNetwork(server, network) {
  const actual = await server.getNetwork();
  if (actual.passphrase !== network.passphrase) {
    throw new Error(`RPC endpoint is not connected to ${network.id}`);
  }
  return actual;
}

export async function selectRpcUrl(
  network,
  createServer = (url) => new rpc.Server(url),
) {
  for (const url of network.rpcUrls || [network.rpcUrl]) {
    try {
      await assertRpcNetwork(createServer(url), network);
      return url;
    } catch {}
  }
  throw new Error(`no healthy ${network.id} RPC endpoint is available`);
}
