import { Networks } from "@stellar/stellar-sdk";

const PROFILES = {
  testnet: {
    id: "testnet",
    label: "Stellar testnet",
    passphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    deploymentPath: "deployments/private-testnet.json",
    artifactPath: "circuits/private-build/public",
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
  return {
    ...profile,
    rpcUrl:
      scoped(env, id, "RPC_URL") ||
      env.RPC_URL ||
      profile.rpcUrl,
    horizonUrl:
      scoped(env, id, "HORIZON_URL") ||
      env.HORIZON_URL ||
      profile.horizonUrl,
    deploymentPath:
      scoped(env, id, "DEPLOYMENT") ||
      env.MOROS_PUBLIC_DEPLOYMENT ||
      profile.deploymentPath,
    artifactPath:
      scoped(env, id, "ZK_PUBLIC_DIR") ||
      env.MOROS_ZK_PUBLIC_DIR ||
      profile.artifactPath,
    funderSecret:
      scoped(env, id, "FUNDER_SK") ||
      env.FUNDER_SK ||
      "",
    privacySecret:
      scoped(env, id, "PRIVACY_SK") ||
      env.MOROS_PRIVACY_SK ||
      (id === "testnet" ? env.MOROS_TESTNET_PRIVACY_SK : "") ||
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
