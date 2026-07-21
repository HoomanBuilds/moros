import {
  rpc,
  TransactionBuilder,
  Operation,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { getKit } from "@/lib/wallet";
import {
  MARKET_WASM_HASH,
  POOL_WASM_HASH,
  COMMITTEE_MEMBERS,
  COMMITTEE_THRESHOLD,
  LMSR_B,
  MARKET_SUBSIDY,
  REDEEM_VK,
  PRICE_RESOLVER_ID,
  EVENT_RESOLVER_ID,
  RESOLVABLE_ASSETS,
  PLATFORM_TREASURY,
  PLATFORM_FEE_BPS,
  BATCH_GRACE_SECONDS,
  EVENT_MARKETS_ENABLED,
} from "./deploy-constants";

const server = new rpc.Server(NETWORK.rpcUrl);

export type DeployStep = "market" | "funding" | "pool" | "batcher" | "committee" | "redeemvk" | "resolver" | "registration" | "listing" | "done";

export type DeploymentMetadata = {
  title: string;
  category: string;
  subject?: string;
  bannerDownloadUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
};

export type PendingDeployment = {
  address: string;
  asset: string;
  strikeUsd: number;
  expiryUnix: number;
  resolverType: "price" | "event";
  resolverId: string;
  rulesHash?: string;
  metadata: DeploymentMetadata;
  marketWasmHash: string;
  poolWasmHash: string;
  marketId?: string;
  funded?: boolean;
  poolId?: string;
  batcherConfigured?: boolean;
  committeeConfigured?: boolean;
  redeemVkConfigured?: boolean;
  resolverConfigured?: boolean;
  eventRegistered?: boolean;
  complete?: boolean;
};

const PENDING_DEPLOYMENT_KEY = "moros.pending-market";

function pendingKey(address: string): string {
  return `${PENDING_DEPLOYMENT_KEY}.${address}`;
}

export function getPendingDeployment(address: string): PendingDeployment | null {
  if (typeof localStorage === "undefined" || !address) return null;
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey(address)) ?? "null") as PendingDeployment | null;
    if (!value || value.address !== address) return null;
    return value;
  } catch {
    return null;
  }
}

function storePendingDeployment(deployment: PendingDeployment): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(pendingKey(deployment.address), JSON.stringify(deployment));
  }
}

export function clearPendingDeployment(address: string): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(pendingKey(address));
}

function bytesArg(hex: string): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
}

function addr(a: string): xdr.ScVal {
  return Address.fromString(a).toScVal();
}

function randomSalt(): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export function strikeToRaw(strikeUsd: number): bigint {
  return BigInt(Math.round(strikeUsd * 1e4)) * 10_000_000_000n;
}

async function signSend(tx: import("@stellar/stellar-sdk").Transaction, address: string) {
  const prepared = await server.prepareTransaction(tx);
  const { signedTxXdr } = await getKit().signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
  if (sent.status === "ERROR") throw new Error("transaction rejected by network");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await server.getTransaction(sent.hash);
    if (g.status === "SUCCESS") return g;
    if (g.status === "FAILED") throw new Error("transaction failed on-chain");
  }
  throw new Error("transaction timed out");
}

async function deployByHash(wasmHash: string, ctorArgs: xdr.ScVal[], address: string): Promise<string> {
  const acc = await server.getAccount(address);
  const tx = new TransactionBuilder(acc, { fee: "3000000", networkPassphrase: NETWORK.passphrase })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(address),
        wasmHash: Buffer.from(wasmHash, "hex"),
        salt: randomSalt(),
        constructorArgs: ctorArgs,
      }),
    )
    .setTimeout(120)
    .build();
  const g = await signSend(tx, address);
  return scValToNative(g.returnValue!) as string;
}

async function invokeSigned(contractId: string, method: string, args: xdr.ScVal[], address: string) {
  const acc = await server.getAccount(address);
  const c = new Contract(contractId);
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(c.call(method, ...args))
    .setTimeout(120)
    .build();
  return signSend(tx, address);
}

export async function deployShieldedMarket({
  address,
  asset,
  strikeUsd,
  expiryUnix,
  resolverType,
  rulesHash,
  metadata,
  resume,
  onStep,
  onProgress,
}: {
  address: string;
  asset: string;
  strikeUsd: number;
  expiryUnix: number;
  resolverType: "price" | "event";
  rulesHash?: string;
  metadata: DeploymentMetadata;
  resume?: PendingDeployment | null;
  onStep: (s: DeployStep) => void;
  onProgress?: (deployment: PendingDeployment) => void;
}): Promise<{ marketId: string; poolId: string; deployment: PendingDeployment }> {
  let deployment: PendingDeployment = resume ?? {
    address,
    asset,
    strikeUsd,
    expiryUnix,
    resolverType,
    resolverId: resolverType === "event" ? EVENT_RESOLVER_ID : PRICE_RESOLVER_ID,
    rulesHash,
    metadata,
    marketWasmHash: MARKET_WASM_HASH,
    poolWasmHash: POOL_WASM_HASH,
  };
  if (deployment.address !== address) throw new Error("The saved deployment belongs to a different wallet");

  const checkpoint = (update: Partial<PendingDeployment>) => {
    deployment = { ...deployment, ...update };
    storePendingDeployment(deployment);
    onProgress?.(deployment);
  };
  checkpoint({});

  if (deployment.resolverType === "event" && !EVENT_MARKETS_ENABLED) {
    throw new Error("Event markets are unavailable until their resolution operations are live");
  }
  if (deployment.resolverType === "price" && !RESOLVABLE_ASSETS.includes(deployment.asset.toUpperCase())) {
    throw new Error(`${deployment.asset} does not have price-oracle quorum support`);
  }
  const resolverId = deployment.resolverId;
  if (!resolverId) throw new Error(`${resolverType} resolver is not configured on ${NETWORK.name}`);
  Address.fromString(resolverId);
  if (deployment.resolverType === "event" && !/^[0-9a-f]{64}$/.test(deployment.rulesHash ?? "")) {
    throw new Error("Event rules hash is invalid");
  }

  onStep("market");
  let marketId = deployment.marketId;
  if (!marketId) {
    marketId = await deployByHash(
      deployment.marketWasmHash,
      [
        addr(address),
        addr(NETWORK.collateral.sac),
        nativeToScVal(BigInt(LMSR_B), { type: "i128" }),
        nativeToScVal(deployment.asset, { type: "symbol" }),
        nativeToScVal(strikeToRaw(deployment.strikeUsd), { type: "i128" }),
        nativeToScVal(BigInt(deployment.expiryUnix), { type: "u64" }),
        nativeToScVal(BigInt(BATCH_GRACE_SECONDS), { type: "u64" }),
      ],
      address,
    );
    checkpoint({ marketId });
  }

  onStep("funding");
  if (!deployment.funded) {
    await invokeSigned(
      marketId,
      "fund",
      [addr(address), nativeToScVal(BigInt(MARKET_SUBSIDY), { type: "i128" })],
      address,
    );
    checkpoint({ funded: true });
  }

  onStep("pool");
  let poolId = deployment.poolId;
  if (!poolId) {
    poolId = await deployByHash(
      deployment.poolWasmHash,
      [
        addr(NETWORK.collateral.sac),
        addr(address),
        addr(marketId),
        addr(PLATFORM_TREASURY),
        nativeToScVal(PLATFORM_FEE_BPS, { type: "u32" }),
      ],
      address,
    );
    checkpoint({ poolId });
  }

  onStep("batcher");
  if (!deployment.batcherConfigured) {
    await invokeSigned(marketId, "set_batcher", [addr(address), addr(poolId)], address);
    checkpoint({ batcherConfigured: true });
  }

  onStep("committee");
  if (!deployment.committeeConfigured) {
    await invokeSigned(
      poolId,
      "set_committee",
      [
        addr(address),
        xdr.ScVal.scvVec(COMMITTEE_MEMBERS.map((m) => addr(m))),
        nativeToScVal(COMMITTEE_THRESHOLD, { type: "u32" }),
      ],
      address,
    );
    checkpoint({ committeeConfigured: true });
  }

  onStep("redeemvk");
  if (!deployment.redeemVkConfigured) {
    await invokeSigned(poolId, "set_redeem_vk", [addr(address), bytesArg(REDEEM_VK)], address);
    checkpoint({ redeemVkConfigured: true });
  }

  onStep("resolver");
  if (!deployment.resolverConfigured) {
    await invokeSigned(marketId, "set_resolver", [addr(address), addr(resolverId)], address);
    checkpoint({ resolverConfigured: true });
  }
  if (deployment.resolverType === "event" && !deployment.eventRegistered) {
    await invokeSigned(
      resolverId,
      "register_market",
      [addr(marketId), addr(address), bytesArg(deployment.rulesHash!)],
      address,
    );
    checkpoint({ eventRegistered: true });
  }

  checkpoint({ complete: true });
  return { marketId, poolId, deployment };
}
