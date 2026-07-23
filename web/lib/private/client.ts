"use client";

import { COMMITTEE_URL } from "@/lib/committee/config";
import { NETWORK } from "@/lib/network";

export type PrivateDeploymentConfig = {
  network: "testnet";
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

const PRIVATE_SERVICE =
  process.env.NEXT_PUBLIC_PRIVATE_SERVICE_URL || COMMITTEE_URL;

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string"
    ? body.error
    : `Private service returned HTTP ${response.status}`;
}

export async function getPrivateConfig(): Promise<PrivateDeploymentConfig> {
  const response = await fetch(`${PRIVATE_SERVICE}/private/config`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const config = await response.json() as PrivateDeploymentConfig;
  if (
    config.network !== "testnet" ||
    config.mainnetReady !== false ||
    config.collateral.code !== "USDC" ||
    config.collateral.contract !== NETWORK.collateral.sac ||
    config.marketPolicy.fixedBatchSize !== 8 ||
    config.marketPolicy.minimumSideCount < 2
  ) {
    throw new Error("Private service configuration is incompatible");
  }
  return config;
}

export async function registerPrivateMarket(market: string): Promise<void> {
  const response = await fetch(
    `${PRIVATE_SERVICE}/private/register-market`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market }),
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}
