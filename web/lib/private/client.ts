"use client";

import { COMMITTEE_URL } from "@/lib/committee/config";
import { NETWORK } from "@/lib/network";

export type PrivateDeploymentConfig = {
  network: "testnet";
  networkDomain: string;
  verifierDomain: string;
  artifactBase: string;
  collateral: {
    code: "USDC";
    contract: string;
    decimals: number;
  };
  contracts: {
    verifier: string;
    resolver: string;
    sharedVault: string;
    factory: string;
  };
  privacy: {
    treeLevels: number;
    genesisRoot: string;
    rootHistorySize: number;
    maxRootAge: number;
    committeeEpoch: number;
    committeeConfigHash: string;
    committeePublicKeyX: string;
    committeePublicKeyY: string;
    treasuryKey: string;
    testnetSingleVmCommittee: true;
  };
  marketPolicy: {
    allowedAssets: string[];
    liquidityTiers: string[];
    feeMaximumBps: number;
    lpFeeShareBps: number;
    fixedBatchSize: number;
    minimumSideCount: number;
    maximumPriceMovement: string;
    minimumFundingWindow: number;
    minimumOpenWindow: number;
    maximumMarketDuration: number;
  };
  mainnetReady: false;
};

export type IndexedPrivateOutput = {
  commitment: string;
  leafIndex: number;
  root: string;
  actionId: string;
  encryptedOutput: string;
};

export type PrivateTreeSnapshot = {
  vaultId: string;
  levels: number;
  nextLeafIndex: number;
  currentRoot: string;
  commitments: string[];
  outputs: IndexedPrivateOutput[];
  updatedAt: string;
};

export type EncryptedPrivateAllocation = {
  market: string;
  epoch: string;
  positionCommitment: string;
  envelope: string[];
};

const PRIVATE_SERVICE =
  process.env.NEXT_PUBLIC_PRIVATE_SERVICE_URL || COMMITTEE_URL;

export function privateServiceUrl(path: string): string {
  return `${PRIVATE_SERVICE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function privateArtifactUrl(
  config: Pick<PrivateDeploymentConfig, "artifactBase">,
  relative: string,
): string {
  const base = new URL(config.artifactBase, privateServiceUrl("/"));
  const normalized = base.toString().endsWith("/")
    ? base
    : new URL(`${base.toString()}/`);
  return new URL(relative, normalized).toString();
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string"
    ? body.error
    : `Private service returned HTTP ${response.status}`;
}

export async function getPrivateConfig(): Promise<PrivateDeploymentConfig> {
  const response = await fetch(privateServiceUrl("/private/config"), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const config = await response.json() as PrivateDeploymentConfig;
  if (
    config.network !== "testnet" ||
    config.mainnetReady !== false ||
    config.collateral.code !== "USDC" ||
    config.collateral.contract !== NETWORK.collateral.sac ||
    !/^[0-9a-f]{64}$/u.test(config.networkDomain) ||
    !/^[0-9a-f]{64}$/u.test(config.verifierDomain) ||
    config.privacy.treeLevels !== 20 ||
    config.marketPolicy.fixedBatchSize !== 8 ||
    config.marketPolicy.minimumSideCount < 2
  ) {
    throw new Error("Private service configuration is incompatible");
  }
  return config;
}

export async function registerPrivateMarket(market: string): Promise<void> {
  const response = await fetch(
    privateServiceUrl("/private/register-market"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market }),
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function registerPrivateProposal(proposalId: string): Promise<void> {
  const response = await fetch(
    privateServiceUrl("/private/register-proposal"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposalId }),
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function getPrivateTree(): Promise<PrivateTreeSnapshot> {
  const response = await fetch(privateServiceUrl("/private/tree"), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const tree = await response.json() as PrivateTreeSnapshot;
  if (
    tree.levels !== 20 ||
    tree.nextLeafIndex !== tree.commitments?.length ||
    tree.nextLeafIndex !== tree.outputs?.length ||
    !/^\d+$/u.test(tree.currentRoot)
  ) {
    throw new Error("Private tree response is incompatible");
  }
  return tree;
}

export async function getPrivateAllocation(
  market: string,
  epoch: bigint,
  positionCommitment: bigint,
): Promise<EncryptedPrivateAllocation> {
  const query = new URLSearchParams({
    market,
    epoch: epoch.toString(),
    commitment: positionCommitment.toString(),
  });
  const response = await fetch(
    privateServiceUrl(`/private/allocation?${query.toString()}`),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  const allocation = await response.json() as EncryptedPrivateAllocation;
  if (
    allocation.market !== market ||
    allocation.epoch !== epoch.toString() ||
    allocation.positionCommitment !== positionCommitment.toString() ||
    !Array.isArray(allocation.envelope) ||
    allocation.envelope.length !== 20 ||
    allocation.envelope.some((value) => !/^\d+$/u.test(value))
  ) {
    throw new Error("Private allocation response is incompatible");
  }
  return allocation;
}

export async function relayPrivateCall(
  method: string,
  args: string[],
): Promise<{ hash: string }> {
  const response = await fetch(privateServiceUrl("/private/relay"), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const result = await response.json() as { hash?: unknown };
  if (typeof result.hash !== "string") {
    throw new Error("Private relay did not return a transaction hash");
  }
  return { hash: result.hash };
}
