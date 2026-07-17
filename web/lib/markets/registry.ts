"use client";
import { useSyncExternalStore } from "react";
import { NETWORK } from "@/lib/network";
import { fetchMarketRegistry } from "@/lib/supabase/markets-meta";
import { dedupeMarkets, type MarketEntry } from "./dedupe";

export { dedupeMarkets, type MarketEntry };

const SEEDS: MarketEntry[] = [
  {
    marketId: NETWORK.marketId,
    poolId: NETWORK.poolId,
    asset: "XLM",
    kind: "shielded",
    flagship: true,
  },
  {
    marketId: "CDEQRY2APGMW6T3PWBUJB2HFBVVFNFBNMHTYTALZO4SDECM4Z6SZXIZI",
    poolId: "CCIGDYFQTK5Y43HNRGNYM5B4FQIUZE3J46T6O3D5BYVVQVA6JMTTXUZF",
    asset: "ETH",
    kind: "shielded",
  },
];

const KEY = "umbra.markets.v1";
let localCreated: MarketEntry[] | null = null;
let remote: MarketEntry[] = [];
const listeners = new Set<() => void>();

function loadLocal(): MarketEntry[] {
  if (localCreated) return localCreated;
  let list: MarketEntry[] = [];
  if (typeof localStorage !== "undefined") {
    try {
      list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      list = [];
    }
  }
  localCreated = list;
  return list;
}

function persist() {
  if (typeof localStorage !== "undefined" && localCreated) localStorage.setItem(KEY, JSON.stringify(localCreated));
}

function build(): MarketEntry[] {
  return dedupeMarkets([...SEEDS, ...remote, ...(localCreated ?? [])]);
}

function emit() {
  for (const l of listeners) l();
}

let snapshot: MarketEntry[] = [...SEEDS];
if (typeof window !== "undefined") {
  loadLocal();
  snapshot = build();
}

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
  const c = loadLocal();
  if (!c.some((m) => m.marketId === entry.marketId)) c.unshift(entry);
  persist();
  snapshot = build();
  emit();
}

export async function refreshMarkets(): Promise<void> {
  try {
    remote = (await fetchMarketRegistry()).map((r) => ({
      marketId: r.marketId,
      poolId: r.poolId,
      asset: r.asset || "?",
      kind: "shielded" as const,
      createdAt: r.createdAt,
    }));
    snapshot = build();
    emit();
  } catch {
    return;
  }
}

if (typeof window !== "undefined") refreshMarkets();
