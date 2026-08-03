"use client";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMarket,
  marketFromPrivateCatalog,
} from "@/lib/stellar/use-market";
import {
  useMarketRegistryReady,
  useMarkets,
  type MarketEntry,
} from "./registry";
import { collateralForEntry } from "./market-context";
import {
  getPrivateMarketCatalog,
  isPrivateMarketCatalogEntryFresh,
  isPrivateMarketCatalogSnapshotFresh,
  type PrivateMarketCatalogEntry,
} from "@/lib/private/client";

export type MarketRow = {
  id: string;
  href: string;
  asset: string;
  category?: string;
  subject?: string;
  bannerUrl?: string;
  bannerSourceUrl?: string;
  bannerAttribution?: string;
  bannerLicense?: string;
  bannerLicenseUrl?: string;
  resolverType: "price" | "event";
  resolutionRules?: string;
  question: string;
  strike: string;
  strikeNum: number;
  probYes: number | null;
  yesCents: number | null;
  outcome: "YES" | "NO" | "VOID" | "LIVE";
  live: boolean;
  resolutionLabel: string;
  secondsLeft: number;
  poolSize: number;
  collateralCode: string;
  orders: number;
  flagship: boolean;
};

async function fetchRow(
  entry: MarketEntry,
  snapshot?: PrivateMarketCatalogEntry,
  catalogCheckedAt = Date.now(),
  catalogFresh = true,
): Promise<MarketRow> {
  const collateral = collateralForEntry(entry);
  const directRead = () => fetchMarket(
    entry.marketId,
    entry.poolId,
    collateral,
    entry,
  );
  let data: Awaited<ReturnType<typeof fetchMarket>>;
  if (snapshot && entry.resolverType !== "event") {
    if (
      catalogFresh &&
      isPrivateMarketCatalogEntryFresh(snapshot, catalogCheckedAt)
    ) {
      data = marketFromPrivateCatalog(snapshot, collateral, entry);
    } else {
      data = await directRead().catch(() =>
        marketFromPrivateCatalog(snapshot, collateral, entry)
      );
    }
  } else {
    data = await directRead();
  }
  return {
    id: entry.marketId,
    href: `/app/market/${entry.marketId}`,
    asset: data.asset,
    category: data.category,
    subject: data.subject,
    bannerUrl: data.bannerUrl,
    bannerSourceUrl: data.bannerSourceUrl,
    bannerAttribution: data.bannerAttribution,
    bannerLicense: data.bannerLicense,
    bannerLicenseUrl: data.bannerLicenseUrl,
    resolverType: data.resolverType,
    resolutionRules: data.resolutionRules,
    question: data.question,
    strike: data.strike,
    strikeNum: Number(data.strike),
    probYes: data.probYes,
    yesCents: Math.round(data.probYes * 100),
    outcome: data.outcome,
    live: data.acceptingOrders,
    resolutionLabel: data.resolutionLabel,
    secondsLeft: data.secondsLeft,
    poolSize: data.poolSize,
    collateralCode: collateral.code,
    orders: data.orderCount,
    flagship: !!entry.flagship,
  };
}

export function fulfilledMarketRows<T>(
  settled: PromiseSettledResult<T>[],
  expected: number,
): T[] {
  const rows = settled.flatMap((row) =>
    row.status === "fulfilled" ? [row.value] : []
  );
  if (expected > 0 && rows.length === 0) {
    throw new Error("No market state could be verified");
  }
  return rows;
}

export function useMarketCatalog(): {
  rows: MarketRow[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
} {
  const markets = useMarkets();
  const registryReady = useMarketRegistryReady();
  const marketKey = markets.map((market) => [
    market.marketId,
    market.poolId,
    market.liquidityVaultId ?? "missing-private-vault",
  ]);
  const result = useQuery({
    queryKey: ["market-catalog", marketKey],
    enabled: markets.length > 0,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      let snapshotByMarket = new Map<string, PrivateMarketCatalogEntry>();
      let catalogCheckedAt = Date.now();
      let catalogFresh = false;
      try {
        const snapshot = await getPrivateMarketCatalog();
        catalogCheckedAt = Date.parse(snapshot.checkedAt);
        catalogFresh = isPrivateMarketCatalogSnapshotFresh(snapshot);
        snapshotByMarket = new Map(
          snapshot.markets.map((entry) => [entry.market, entry]),
        );
      } catch {
        // The direct read fallback keeps the page available during rollout.
      }
      const settled = await Promise.allSettled(markets.map((market) =>
        fetchRow(
          market,
          snapshotByMarket.get(market.marketId),
          catalogCheckedAt,
          catalogFresh,
        )
      ));
      return fulfilledMarketRows(settled, markets.length);
    },
  });
  return {
    rows: result.data ?? [],
    isLoading: !registryReady || result.isLoading,
    isError: result.isError,
    retry: () => {
      void result.refetch();
    },
  };
}
