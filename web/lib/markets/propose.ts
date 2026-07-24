"use client";

import {
  TransactionBuilder,
  contract,
  rpc,
} from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { getKit } from "@/lib/wallet";
import {
  getPrivateConfig,
  type PrivateDeploymentConfig,
} from "@/lib/private/client";
import {
  strikeToRaw,
  type DeploymentMetadata,
} from "./proposal-types";

export type ProposalStep =
  | "configuration"
  | "proposal"
  | "liquidity"
  | "listing"
  | "done";

export type PendingProposal = {
  address: string;
  factoryId: string;
  proposalId: string;
  marketId: string;
  liquidityVaultId: string;
  asset: string;
  strikeUsd: number;
  expiryUnix: number;
  fundingDeadline: number;
  activationCutoff: number;
  liquidityTarget: string;
  lotSize: string;
  feeBps: number;
  rulesHash: string;
  metadataHash: string;
  nonce: string;
  metadata: DeploymentMetadata;
  proposed: boolean;
  liquidityDeployed: boolean;
};

const PENDING_KEY = "moros.pending-proposal";
const Q32 = 1n << 32n;

type ChainProposal = {
  liquidity_vault?: string;
  state_version: bigint | number;
};

type FactoryTransaction = {
  signAndSend: () => Promise<unknown>;
};

type FactoryClient = {
  proposal_id: (args: {
    request: ReturnType<typeof requestFrom>;
  }) => Promise<{ result: Uint8Array }>;
  market_address: (args: {
    proposal_id: Buffer;
  }) => Promise<{ result: string }>;
  liquidity_address: (args: {
    proposal_id: Buffer;
  }) => Promise<{ result: string }>;
  proposal: (args: {
    proposal_id: Buffer;
  }) => Promise<{ result?: ChainProposal }>;
  propose: (args: {
    request: ReturnType<typeof requestFrom>;
  }) => Promise<FactoryTransaction>;
  deploy_liquidity: (args: {
    proposal_id: Buffer;
    expected_version: bigint;
  }) => Promise<FactoryTransaction>;
};

function key(address: string): string {
  return `${PENDING_KEY}.${address}`;
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(value: string): Buffer {
  return Buffer.from(value, "hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((field) =>
      `${JSON.stringify(field)}:${canonical(source[field])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  const input = new TextEncoder().encode(canonical(value));
  const buffer = input.buffer.slice(
    input.byteOffset,
    input.byteOffset + input.byteLength,
  ) as ArrayBuffer;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

function randomId(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export function getPendingProposal(address: string): PendingProposal | null {
  if (typeof localStorage === "undefined" || !address) return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(key(address)) || "null",
    ) as PendingProposal | null;
    return value?.address === address ? value : null;
  } catch {
    return null;
  }
}

function savePendingProposal(value: PendingProposal): void {
  localStorage.setItem(key(value.address), JSON.stringify(value));
}

export function clearPendingProposal(address: string): void {
  localStorage.removeItem(key(address));
}

export function proposalTiming(
  expiryUnix: number,
  config: PrivateDeploymentConfig,
  now = Math.floor(Date.now() / 1_000),
): { fundingDeadline: number; activationCutoff: number } {
  const fundingWindow = config.marketPolicy.minimumFundingWindow;
  const openWindow = config.marketPolicy.minimumOpenWindow;
  const activationCutoff = expiryUnix - openWindow;
  const preferredFundingDeadline = Math.min(
    now + 86_400,
    activationCutoff - 300,
  );
  const fundingDeadline = Math.max(
    now + fundingWindow + 60,
    preferredFundingDeadline,
  );
  if (
    fundingDeadline > activationCutoff ||
    expiryUnix > now + config.marketPolicy.maximumMarketDuration
  ) {
    throw new Error(
      "Settlement is too soon or too far away for funding and market operation",
    );
  }
  return { fundingDeadline, activationCutoff };
}

function requestFrom(value: PendingProposal) {
  return {
    creator: value.address,
    nonce: fromHex(value.nonce),
    asset: value.asset,
    threshold: strikeToRaw(value.strikeUsd),
    rules_hash: fromHex(value.rulesHash),
    metadata_hash: fromHex(value.metadataHash),
    funding_deadline: BigInt(value.fundingDeadline),
    activation_cutoff: BigInt(value.activationCutoff),
    expiry: BigInt(value.expiryUnix),
    liquidity_target: BigInt(value.liquidityTarget),
    lot_size: BigInt(value.lotSize),
    fee_bps: value.feeBps,
  };
}

async function factoryClient(
  factoryId: string,
  address: string,
) {
  const server = new rpc.Server(NETWORK.rpcUrl);
  const wasm = await server.getContractWasmByContractId(factoryId);
  return contract.Client.fromWasm(wasm, {
    contractId: factoryId,
    publicKey: address,
    networkPassphrase: NETWORK.passphrase,
    rpcUrl: NETWORK.rpcUrl,
    signTransaction: async (
      transactionXdr: string,
      options: { networkPassphrase?: string } = {},
    ) => {
      const passphrase = options.networkPassphrase || NETWORK.passphrase;
      const { signedTxXdr } = await getKit().signTransaction(
        transactionXdr,
        { networkPassphrase: passphrase, address },
      );
      TransactionBuilder.fromXDR(signedTxXdr, passphrase);
      return { signedTxXdr, signerAddress: address };
    },
  }) as unknown as FactoryClient;
}

export async function proposeMarket({
  address,
  asset,
  strikeUsd,
  expiryUnix,
  liquidityTarget,
  metadata,
  resume,
  onStep,
  onProgress,
}: {
  address: string;
  asset: string;
  strikeUsd: number;
  expiryUnix: number;
  liquidityTarget?: bigint;
  metadata: DeploymentMetadata;
  resume?: PendingProposal | null;
  onStep: (step: ProposalStep) => void;
  onProgress?: (proposal: PendingProposal) => void;
}): Promise<PendingProposal> {
  onStep("configuration");
  const config = await getPrivateConfig();
  const factory = await factoryClient(config.contracts.factory, address);
  let proposal = resume;
  if (!proposal) {
    const policyTiers = config.marketPolicy.liquidityTiers.map(BigInt);
    const target = liquidityTarget ?? policyTiers[0];
    if (!policyTiers.includes(target)) {
      throw new Error("Select a supported liquidity target");
    }
    const { fundingDeadline, activationCutoff } = proposalTiming(
      expiryUnix,
      config,
    );
    const nonce = randomId();
    const rulesHash = await digest({
      kind: "price",
      asset,
      strikeUsd,
      expiryUnix,
      resolver: config.contracts.resolver,
    });
    const metadataHash = await digest(metadata);
    const draft = {
      address,
      factoryId: config.contracts.factory,
      proposalId: "",
      marketId: "",
      liquidityVaultId: "",
      asset,
      strikeUsd,
      expiryUnix,
      fundingDeadline,
      activationCutoff,
      liquidityTarget: target.toString(),
      lotSize: Q32.toString(),
      feeBps: Math.min(200, config.marketPolicy.feeMaximumBps),
      rulesHash,
      metadataHash,
      nonce,
      metadata,
      proposed: false,
      liquidityDeployed: false,
    } satisfies PendingProposal;
    const proposalId = hex(
      (await factory.proposal_id({
        request: requestFrom(draft),
      })).result,
    );
    proposal = {
      ...draft,
      proposalId,
      marketId: (await factory.market_address({
        proposal_id: fromHex(proposalId),
      })).result,
      liquidityVaultId: (await factory.liquidity_address({
        proposal_id: fromHex(proposalId),
      })).result,
    };
    savePendingProposal(proposal);
    onProgress?.(proposal);
  }
  if (
    proposal.address !== address ||
    proposal.factoryId !== config.contracts.factory
  ) {
    throw new Error("The saved proposal belongs to another wallet or factory");
  }
  const proposalId = fromHex(proposal.proposalId);
  let chainProposal = (
    await factory.proposal({ proposal_id: proposalId })
  ).result;

  onStep("proposal");
  if (!chainProposal) {
    await (
      await factory.propose({ request: requestFrom(proposal) })
    ).signAndSend();
    chainProposal = (
      await factory.proposal({ proposal_id: proposalId })
    ).result;
  }
  if (!chainProposal) throw new Error("Factory did not confirm the proposal");
  proposal = { ...proposal, proposed: true };
  savePendingProposal(proposal);
  onProgress?.(proposal);

  onStep("liquidity");
  if (!chainProposal.liquidity_vault) {
    await (
      await factory.deploy_liquidity({
        proposal_id: proposalId,
        expected_version: BigInt(chainProposal.state_version),
      })
    ).signAndSend();
    chainProposal = (
      await factory.proposal({ proposal_id: proposalId })
    ).result;
  }
  if (chainProposal?.liquidity_vault !== proposal.liquidityVaultId) {
    throw new Error("Factory liquidity deployment did not match its address");
  }
  proposal = { ...proposal, liquidityDeployed: true };
  savePendingProposal(proposal);
  onProgress?.(proposal);
  return proposal;
}
