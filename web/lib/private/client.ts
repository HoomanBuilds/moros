"use client";

import { COMMITTEE_URL } from "@/lib/committee/config";
import { NETWORK } from "@/lib/network";

export type PrivateDeploymentConfig = {
  network: "testnet" | "mainnet";
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
    resolverRegistry: string;
    sharedVault: string;
    liquidityPool: string;
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
    committeeMode?: "single_vm" | "threshold";
    testnetSingleVmCommittee: boolean;
  };
  marketPolicy: {
    allowedAssets: string[];
    assetRiskGroups: {
      asset: string;
      risk_group: string;
    }[];
    liquidityTiers: string[];
    feeMaximumBps: number;
    lpFeeShareBps: number;
    maximumBatchSize: number;
    minimumSideCount: number;
    maximumPriceMovement: string;
    batchGrace: number;
    epochDuration: number;
    refundDelay: number;
    minimumFundingWindow: number;
    minimumOpenWindow: number;
    maximumMarketDuration: number;
  };
  resolverRegistryPolicy: {
    changeDelay: number;
    routes: {
      asset: string;
      resolver: string;
      riskGroup: string;
      registrationRequired: boolean;
      enabled: boolean;
      revision: number;
    }[];
  };
  liquidityPolicy: {
    depositCap: string;
    maxActiveAllocations: number;
    maxDeployedBps: number;
    maxMarketBps: number;
    maxGroupBps: number;
    minimumIdleBps: number;
    withdrawalWindow: number;
    maxWithdrawalBps: number;
  };
  mainnetReady: boolean;
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

type PrivateTreeResponse = PrivateTreeSnapshot & {
  fromLeafIndex?: number;
  baseRoot?: string;
};

export type PrivateOutputStatus = {
  indexed: boolean;
  output?: IndexedPrivateOutput;
  nextLeafIndex: number;
  currentRoot: string;
};

export type EncryptedPrivateAllocation = {
  market: string;
  epoch: string;
  positionCommitment: string;
  envelope: string[];
};

export type PrivateLiquidityExit = {
  market: string;
  liquidityVault: string;
  exitId: string;
  status: string;
  intent?: {
    shares_remaining: string;
    minimum_payment_remaining: string;
    destination: string;
    payment_destination: {
      commitment: string;
      spend_public_key: string;
      viewing_public_key_x: string;
      viewing_public_key_y: string;
      note_id: string;
      blinding: string;
    };
    expiry: string;
    status: string;
  };
  snapshot?: {
    state_version: string;
    equity_if_yes: string;
    equity_if_no: string;
    conditional_lp_fees: string;
    updated_at: string;
  };
  stateVersion?: string;
  checkedAt: string;
  error?: string;
};

const PRIVATE_SERVICE =
  process.env.NEXT_PUBLIC_PRIVATE_SERVICE_URL || COMMITTEE_URL;
let privateConfigPromise: Promise<PrivateDeploymentConfig> | null = null;
let privateTreeCache: PrivateTreeSnapshot | null = null;
let privateTreePromise: Promise<PrivateTreeSnapshot> | null = null;

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
  if (privateConfigPromise) return privateConfigPromise;
  privateConfigPromise = loadPrivateConfig().catch((error) => {
    privateConfigPromise = null;
    throw error;
  });
  return privateConfigPromise;
}

async function loadPrivateConfig(): Promise<PrivateDeploymentConfig> {
  const response = await fetch(privateServiceUrl("/private/config"), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const config = await response.json() as PrivateDeploymentConfig;
  const committeeMode = config.privacy.committeeMode ??
    (config.privacy.testnetSingleVmCommittee ? "single_vm" : "threshold");
  if (
    config.network !== NETWORK.id ||
    config.mainnetReady !== (NETWORK.id === "mainnet") ||
    config.collateral.code !== "USDC" ||
    config.collateral.contract !== NETWORK.collateral.sac ||
    committeeMode !== "single_vm" ||
    !/^[0-9a-f]{64}$/u.test(config.networkDomain) ||
    !/^[0-9a-f]{64}$/u.test(config.verifierDomain) ||
    !/^C[A-Z2-7]{55}$/u.test(config.contracts.resolverRegistry) ||
    !/^C[A-Z2-7]{55}$/u.test(config.contracts.liquidityPool) ||
    config.resolverRegistryPolicy.changeDelay < 300 ||
    config.resolverRegistryPolicy.routes.some((route) =>
      !route.enabled ||
      route.revision < 1 ||
      !config.marketPolicy.allowedAssets.includes(route.asset)
    ) ||
    config.privacy.treeLevels !== 20 ||
    config.marketPolicy.maximumBatchSize !== 8 ||
    config.marketPolicy.minimumSideCount !== 0 ||
    config.marketPolicy.epochDuration !== 60 ||
    config.marketPolicy.refundDelay < 30
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

function validOutput(
  output: IndexedPrivateOutput,
  leafIndex: number,
): boolean {
  return output?.leafIndex === leafIndex &&
    /^\d+$/u.test(output.commitment) &&
    /^\d+$/u.test(output.root) &&
    /^[0-9a-f]{64}$/u.test(output.actionId) &&
    /^[0-9a-f]+$/u.test(output.encryptedOutput);
}

export function mergePrivateTreeResponse(
  cached: PrivateTreeSnapshot | null,
  tree: PrivateTreeResponse,
): PrivateTreeSnapshot {
  const from = tree.fromLeafIndex ?? 0;
  if (
    tree.levels !== 20 ||
    !Number.isSafeInteger(from) ||
    from < 0 ||
    !Number.isSafeInteger(tree.nextLeafIndex) ||
    tree.nextLeafIndex < from ||
    tree.commitments.length !== tree.outputs.length ||
    tree.nextLeafIndex !== from + tree.outputs.length ||
    !/^\d+$/u.test(tree.currentRoot) ||
    tree.outputs.some((output, index) =>
      !validOutput(output, from + index) ||
      output.commitment !== tree.commitments[index]
    )
  ) {
    throw new Error("Private tree response is incompatible");
  }
  if (from === 0) {
    return {
      vaultId: tree.vaultId,
      levels: tree.levels,
      nextLeafIndex: tree.nextLeafIndex,
      currentRoot: tree.currentRoot,
      commitments: [...tree.commitments],
      outputs: [...tree.outputs],
      updatedAt: tree.updatedAt,
    };
  }
  if (
    !cached ||
    cached.vaultId !== tree.vaultId ||
    cached.levels !== tree.levels ||
    cached.nextLeafIndex !== from ||
    cached.currentRoot !== tree.baseRoot
  ) {
    throw new Error("Private tree delta does not continue the cached tree");
  }
  if (
    tree.nextLeafIndex === from &&
    tree.currentRoot === cached.currentRoot
  ) {
    return cached;
  }
  return {
    ...cached,
    nextLeafIndex: tree.nextLeafIndex,
    currentRoot: tree.currentRoot,
    commitments: [...cached.commitments, ...tree.commitments],
    outputs: [...cached.outputs, ...tree.outputs],
    updatedAt: tree.updatedAt,
  };
}

async function fetchPrivateTree(from: number): Promise<PrivateTreeResponse> {
  const query = new URLSearchParams({ from: String(from) });
  const response = await fetch(privateServiceUrl(`/private/tree?${query}`), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<PrivateTreeResponse>;
}

async function loadPrivateTree(): Promise<PrivateTreeSnapshot> {
  const from = privateTreeCache?.nextLeafIndex ?? 0;
  try {
    const tree = await fetchPrivateTree(from);
    privateTreeCache = mergePrivateTreeResponse(privateTreeCache, tree);
  } catch (error) {
    if (from === 0) throw error;
    privateTreeCache = mergePrivateTreeResponse(
      null,
      await fetchPrivateTree(0),
    );
  }
  return privateTreeCache;
}

export async function getPrivateTree(): Promise<PrivateTreeSnapshot> {
  if (!privateTreePromise) {
    privateTreePromise = loadPrivateTree().finally(() => {
      privateTreePromise = null;
    });
  }
  return privateTreePromise;
}

export async function getPrivateOutputStatus(
  commitment: bigint,
): Promise<PrivateOutputStatus> {
  if (commitment <= 0n) {
    throw new Error("Private output commitment is invalid");
  }
  const query = new URLSearchParams({ commitment: commitment.toString() });
  const response = await fetch(
    privateServiceUrl(`/private/output?${query}`),
    { cache: "no-store" },
  );
  if (response.status === 404) {
    const tree = await getPrivateTree();
    const output = tree.outputs.find((entry) =>
      BigInt(entry.commitment) === commitment
    );
    return {
      indexed: !!output,
      output,
      nextLeafIndex: tree.nextLeafIndex,
      currentRoot: tree.currentRoot,
    };
  }
  if (!response.ok) throw new Error(await errorMessage(response));
  const status = await response.json() as PrivateOutputStatus;
  if (
    typeof status.indexed !== "boolean" ||
    !Number.isSafeInteger(status.nextLeafIndex) ||
    status.nextLeafIndex < 0 ||
    !/^\d+$/u.test(status.currentRoot) ||
    (
      status.indexed &&
      (
        !status.output ||
        !Number.isSafeInteger(status.output.leafIndex) ||
        status.output.leafIndex < 0 ||
        status.output.leafIndex >= status.nextLeafIndex ||
        !validOutput(status.output, status.output.leafIndex) ||
        status.output.commitment !== commitment.toString()
      )
    )
  ) {
    throw new Error("Private output status is incompatible");
  }
  return status;
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

export async function getPrivateLiquidityExits({
  market,
  liquidityVault,
  status,
  offset = 0,
  limit = 200,
}: {
  market?: string;
  liquidityVault?: string;
  status?: string;
  offset?: number;
  limit?: number;
} = {}): Promise<PrivateLiquidityExit[]> {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (market) query.set("market", market);
  if (liquidityVault) query.set("liquidityVault", liquidityVault);
  if (status) query.set("status", status);
  const response = await fetch(
    privateServiceUrl(`/private/exits?${query.toString()}`),
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  const result = await response.json() as {
    exits?: PrivateLiquidityExit[];
    total?: number;
  };
  if (
    !Array.isArray(result.exits) ||
    result.exits.some((entry) =>
      !/^C[A-Z2-7]{55}$/u.test(entry.market) ||
      !/^C[A-Z2-7]{55}$/u.test(entry.liquidityVault) ||
      !/^[0-9a-f]{64}$/u.test(entry.exitId) ||
      typeof entry.status !== "string"
    )
  ) {
    throw new Error("Private liquidity exit response is incompatible");
  }
  return result.exits;
}

export async function registerPrivateLiquidityExit({
  market,
  liquidityVault,
  exitId,
}: {
  market: string;
  liquidityVault: string;
  exitId: string;
}): Promise<PrivateLiquidityExit> {
  const response = await fetch(privateServiceUrl("/private/register-exit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ market, liquidityVault, exitId }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<PrivateLiquidityExit>;
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
