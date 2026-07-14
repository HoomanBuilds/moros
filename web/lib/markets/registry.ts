"use client";
import { useSyncExternalStore } from "react";
import { NETWORK } from "@/lib/network";

export type MarketEntry = {
  marketId: string;
  poolId: string;
  asset: string;
  kind: "shielded";
  flagship?: boolean;
  createdAt?: number;
};

const SEEDS: MarketEntry[] = [
  {
    marketId: NETWORK.marketId,
    poolId: NETWORK.poolId,
    asset: "XLM",
    kind: "shielded",
    flagship: true,
  },
  {
    marketId: "CANELBOQ7EJZJSJW444EPVQROMNS2OMPSCW23NOW72I4WCVNIK252FVB",
    poolId: "CCDGO3D7FWC3S5BWKXTUJCMHFKS7L6FDAUN4X4TOYUA6QHXOFZI7BMLG",
    asset: "ETH",
    kind: "shielded",
  },
];

const KEY = "umbra.markets.v1";
let created: MarketEntry[] | null = null;
const listeners = new Set<() => void>();

function load(): MarketEntry[] {
  if (created) return created;
  if (typeof localStorage === "undefined") {
    created = [];
    return created;
  }
  try {
    created = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    created = [];
  }
  return created;
}

function persist() {
  if (typeof localStorage !== "undefined" && created) localStorage.setItem(KEY, JSON.stringify(created));
}

function emit() {
  for (const l of listeners) l();
}

let snapshot: MarketEntry[] = [...SEEDS];
if (typeof window !== "undefined") snapshot = [...SEEDS, ...load()];

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): MarketEntry[] {
  return snapshot;
}

export function useMarkets(): MarketEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function findMarket(marketId: string): MarketEntry | undefined {
  return snapshot.find((m) => m.marketId === marketId);
}

export function addMarket(entry: MarketEntry) {
  const c = load();
  c.unshift(entry);
  persist();
  snapshot = [...SEEDS, ...c];
  emit();
}
