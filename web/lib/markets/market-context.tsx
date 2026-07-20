"use client";
import { createContext, useContext, type ReactNode } from "react";
import { NETWORK, collateralFromRecord, type CollateralAsset } from "@/lib/network";

type Ids = { marketId: string; poolId: string; collateral?: CollateralAsset };
type ActiveMarket = { marketId: string; poolId: string; collateral: CollateralAsset };

const Ctx = createContext<ActiveMarket>({ marketId: NETWORK.marketId, poolId: NETWORK.poolId, collateral: NETWORK.legacyCollateral });

export function MarketProvider({ marketId, poolId, collateral, children }: Ids & { children: ReactNode }) {
  return <Ctx.Provider value={{ marketId, poolId, collateral: collateral ?? NETWORK.legacyCollateral }}>{children}</Ctx.Provider>;
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
  return collateralFromRecord(entry);
}
