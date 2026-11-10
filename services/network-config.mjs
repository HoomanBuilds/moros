import { Networks, rpc } from "@stellar/stellar-sdk";

const PROFILES = {
  testnet: {
    id: "testnet",
    label: "Stellar testnet",
    passphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    deploymentPath: "deployments/payments-testnet.json",
    artifactPath: "apps/pay-web/public/zk/payments",
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
    deploymentPath: "deployments/payments-mainnet.json",
    artifactPath: "apps/pay-web/public/zk/payments",
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
      (allowLegacy ? env.MOROS_PAYMENT_DEPLOYMENT : "") ||
      profile.deploymentPath,
    artifactPath:
      scoped(env, id, "ZK_PUBLIC_DIR") ||
      (allowLegacy ? env.MOROS_PAYMENT_ZK_PUBLIC_DIR : "") ||
      profile.artifactPath,

  };
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
