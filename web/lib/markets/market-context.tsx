"use client";
import { createContext, useContext, type ReactNode } from "react";
import { NETWORK, collateralFromRecord, type CollateralAsset } from "@/lib/network";

export type MarketDescriptor = {
  liquidityVaultId?: string;
  title?: string;
  category?: string;
  subject?: string;
  bannerUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolverType?: "price" | "event";
  resolutionSource?: string;
  backupResolutionSources?: string[];
  resolutionRules?: string;
  voidRules?: string;
  rulesHash?: string;
};

type Ids = { marketId: string; poolId: string; collateral?: CollateralAsset; descriptor?: MarketDescriptor };
type ActiveMarket = { marketId: string; poolId: string; collateral: CollateralAsset; descriptor?: MarketDescriptor };

const Ctx = createContext<ActiveMarket>({ marketId: NETWORK.marketId, poolId: NETWORK.poolId, collateral: NETWORK.collateral });

export function MarketProvider({ marketId, poolId, collateral, descriptor, children }: Ids & { children: ReactNode }) {
  return <Ctx.Provider value={{ marketId, poolId, collateral: collateral ?? NETWORK.collateral, descriptor }}>{children}</Ctx.Provider>;
}

export function useActiveMarket(): ActiveMarket {
  return useContext(Ctx);
}

export function collateralForEntry(entry: {
  collateralCode?: string;
  collateralIssuer?: string | null;
  collateralSac?: string;
  collateralDecimals?: number;
}): CollateralAsset {
  const collateral = collateralFromRecord(entry);
  if (!collateral) throw new Error("This market does not use supported Stellar USDC collateral");
  return collateral;
}
