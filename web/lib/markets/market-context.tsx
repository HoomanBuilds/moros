"use client";
import { createContext, useContext, type ReactNode } from "react";
import { NETWORK } from "@/lib/network";

type Ids = { marketId: string; poolId: string };

const Ctx = createContext<Ids>({ marketId: NETWORK.marketId, poolId: NETWORK.poolId });

export function MarketProvider({ marketId, poolId, children }: Ids & { children: ReactNode }) {
  return <Ctx.Provider value={{ marketId, poolId }}>{children}</Ctx.Provider>;
}

export function useActiveMarket(): Ids {
  return useContext(Ctx);
}
