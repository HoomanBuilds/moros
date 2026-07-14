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
    marketId: "CBB7RB2XQWS6JFKEGUN236S2ETHP57H23C5XDQJS3TNWUL6LXH5PQWGS",
    poolId: "CDQF6QSDBPQRRNNRWN67RGPU3OV3AAR6KV6XMENTKWYN2VD6O3C7VD3A",
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
