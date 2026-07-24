"use client";
import { useSyncExternalStore } from "react";
import { NETWORK } from "@/lib/network";
import { fetchMarketRegistry } from "@/lib/supabase/markets-meta";
import { EVENT_MARKETS_ENABLED, RESOLVABLE_ASSETS } from "./deploy-constants";
import { dedupeMarkets, type MarketEntry } from "./dedupe";

export { dedupeMarkets, type MarketEntry };

const SEEDS: MarketEntry[] = [];

let remote: MarketEntry[] = [];
let refreshComplete = false;
let refreshInFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function build(): MarketEntry[] {
  return dedupeMarkets([...SEEDS, ...remote]).filter(
    (market) => market.collateralCode === NETWORK.collateral.code
      && market.collateralIssuer === NETWORK.collateral.issuer
      && market.collateralSac === NETWORK.collateral.sac
      && market.collateralDecimals === NETWORK.collateral.decimals
      && (market.resolverType === "price" || (EVENT_MARKETS_ENABLED && market.resolverType === "event"))
      && (market.resolverType !== "price" || RESOLVABLE_ASSETS.includes(market.asset.toUpperCase())),
  );
}

function emit() {
  for (const l of listeners) l();
}

let snapshot: MarketEntry[] = [...SEEDS];

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

export function useMarketRegistryReady(): boolean {
  return useSyncExternalStore(subscribe, () => refreshComplete, () => false);
}

export function findMarket(marketId: string): MarketEntry | undefined {
  return snapshot.find((m) => m.marketId === marketId);
}

export function refreshMarkets(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      remote = (await fetchMarketRegistry()).map((r) => ({
        marketId: r.marketId,
        poolId: r.poolId,
        liquidityVaultId: r.liquidityVaultId,
        asset: r.asset || "?",
        kind: "shielded" as const,
        collateralCode: r.collateralCode,
        collateralIssuer: r.collateralIssuer,
        collateralSac: r.collateralSac,
        collateralDecimals: r.collateralDecimals,
        createdAt: r.createdAt,
        title: r.title,
        category: r.category,
        subject: r.subject,
        bannerUrl: r.bannerUrl,
        bannerSourceUrl: r.bannerSourceUrl,
        bannerAttribution: r.bannerAttribution,
        bannerLicense: r.bannerLicense,
        bannerLicenseUrl: r.bannerLicenseUrl,
        resolverType: r.resolverType,
        resolutionSource: r.resolutionSource,
        backupResolutionSources: r.backupResolutionSources,
        resolutionRules: r.resolutionRules,
        voidRules: r.voidRules,
        rulesHash: r.rulesHash,
      }));
    } catch {
      // Keep the last verified registry snapshot during transient network failures.
    } finally {
      refreshComplete = true;
      snapshot = build();
      emit();
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

if (typeof window !== "undefined") refreshMarkets();
