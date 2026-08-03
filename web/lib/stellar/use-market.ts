"use client";
import { useQuery } from "@tanstack/react-query";
import { getMarketState, getPriceYes, getOutcome, getMarketInfo, getPoolBalance, getMarketResolver, getEventRulesHash, getFeeConfig, getPrivateMarketRegistration, getPrivateOrderCount } from "./read";
import { probFromFixed, fixedToNumber, outcomeLabel, marketQuestion, marketStrike, formatCountdown } from "./derive";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK, type CollateralAsset } from "@/lib/network";
import { formatTokenAmount } from "./amount";
import { getMarketMeta } from "@/lib/supabase/markets-meta";
import type { MarketDescriptor } from "@/lib/markets/market-context";
import { eventRulesHashHex } from "@/lib/markets/rules";
import { marketReadPlan } from "@/lib/markets/market-read-plan";
import {
  getPrivateMarketCatalog,
  type PrivateMarketCatalogEntry,
} from "@/lib/private/client";
import { privateOrderCountFromEpochs } from "./private-order-count";

function fallbackMeta(fallback: MarketDescriptor) {
  return {
    title: fallback.title,
    category: fallback.category,
    subject: fallback.subject,
    bannerUrl: fallback.bannerUrl,
    bannerSourceUrl: fallback.bannerSourceUrl,
    bannerAttribution: fallback.bannerAttribution,
    bannerLicense: fallback.bannerLicense,
    bannerLicenseUrl: fallback.bannerLicenseUrl,
    resolverType: fallback.resolverType ?? "price",
    resolutionSource: fallback.resolutionSource,
    backupResolutionSources: fallback.backupResolutionSources,
    resolutionRules: fallback.resolutionRules,
    voidRules: fallback.voidRules,
    rulesHash: fallback.rulesHash,
  };
}

function privateOrderCount(entry: PrivateMarketCatalogEntry): number {
  return privateOrderCountFromEpochs({
    currentEpochNumber: BigInt(entry.registration.current_epoch),
    currentEpoch: entry.epoch
      ? {
          accepted_count: entry.epoch.accepted_count,
          last_sequence: BigInt(entry.epoch.last_sequence),
        }
      : null,
    previousEpoch: entry.previousEpoch
      ? {
          accepted_count: entry.previousEpoch.accepted_count,
          last_sequence: BigInt(entry.previousEpoch.last_sequence),
        }
      : null,
  });
}

export function marketFromPrivateCatalog(
  entry: PrivateMarketCatalogEntry,
  collateral: CollateralAsset = NETWORK.collateral,
  fallback: MarketDescriptor = {},
) {
  if (fallback.resolverType === "event") {
    throw new Error("Event markets require direct rule verification");
  }
  const state = entry.state.map(BigInt) as [bigint, bigint, bigint];
  const info = {
    asset: entry.info.asset,
    threshold: BigInt(entry.info.threshold),
    expiry: BigInt(entry.info.expiry),
    finalize_after: entry.info.finalize_after
      ? BigInt(entry.info.finalize_after)
      : undefined,
  };
  const meta = fallbackMeta(fallback);
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(info.expiry);
  const secondsLeft = Math.max(0, expiry - now);
  const outcomeVal = outcomeLabel(entry.outcome);
  const acceptingOrders = outcomeVal === "LIVE" && secondsLeft > 0;
  return {
    probYes: probFromFixed(BigInt(entry.priceYes)),
    qYes: fixedToNumber(state[0]),
    qNo: fixedToNumber(state[1]),
    outcome: outcomeVal,
    acceptingOrders,
    phase: outcomeVal === "LIVE" && !acceptingOrders
      ? "CLOSED"
      : outcomeVal,
    question: meta.title || marketQuestion(info),
    asset: info.asset,
    strike: marketStrike(info),
    poolSize: Number(formatTokenAmount(
      BigInt(entry.scenario.market_assets),
      collateral.decimals,
      7,
    )),
    orderCount: privateOrderCount(entry),
    collateral,
    feeBps: entry.registration.fee_bps,
    lotSize: fixedToNumber(BigInt(entry.registration.lot_size)),
    maximumBatchSize: entry.registration.maximum_batch_size,
    minimumSideCount: entry.registration.minimum_side_count,
    expiry,
    finalizeAfter: Number(info.finalize_after ?? info.expiry),
    secondsLeft,
    resolutionLabel: outcomeVal === "LIVE"
      ? acceptingOrders
        ? formatCountdown(secondsLeft)
        : "awaiting final batch and resolution"
      : outcomeVal === "VOID"
        ? "voided and refundable"
        : "resolved",
    ...meta,
    resolverId: null,
    onchainRulesHash: null,
    rulesVerified: true,
  };
}

export async function fetchMarket(
  marketId: string,
  poolId: string,
  collateral: CollateralAsset = NETWORK.collateral,
  fallback: MarketDescriptor = {},
) {
  const readPlan = marketReadPlan({
    marketId,
    poolId,
    liquidityVaultId: fallback.liquidityVaultId,
  });
  const economics = readPlan.feeSource === "private-registration"
    ? Promise.all([
        getPoolBalance(readPlan.balanceOwner, collateral),
        getPrivateMarketRegistration(poolId, marketId),
      ]).then(async ([poolBalance, registration]) => {
        if (!registration || registration.market !== marketId) {
          throw new Error("Private market registration is unavailable");
        }
        return {
          poolBalance,
          orderCount: await getPrivateOrderCount(
            poolId,
            marketId,
            registration,
          ),
          feeBps: registration.fee_bps,
          lotSize: fixedToNumber(registration.lot_size),
          maximumBatchSize: registration.maximum_batch_size,
          minimumSideCount: registration.minimum_side_count,
        };
      })
    : Promise.all([
        getPoolBalance(readPlan.balanceOwner, collateral),
        getFeeConfig(poolId),
      ]).then(([poolBalance, feeConfig]) => ({
        poolBalance,
        orderCount: 0,
        feeBps: Number(feeConfig[1]),
        lotSize: 1,
        maximumBatchSize: null,
        minimumSideCount: null,
      }));
  const [state, priceYes, outcome, info, storedMeta, resolverId, marketEconomics] = await Promise.all([
    getMarketState(marketId),
    getPriceYes(marketId),
    getOutcome(marketId),
    getMarketInfo(marketId),
    fallback.liquidityVaultId
      ? Promise.resolve(null)
      : getMarketMeta(marketId).catch(() => null),
    fallback.resolverType === "event"
      ? getMarketResolver(marketId).catch(() => null)
      : Promise.resolve(null),
    economics,
  ]);
  const meta = {
    title: storedMeta?.title ?? fallback.title,
    category: storedMeta?.category ?? fallback.category,
    subject: storedMeta?.subject ?? fallback.subject,
    bannerUrl: storedMeta?.banner_url ?? fallback.bannerUrl,
    bannerSourceUrl: storedMeta?.banner_source_url ?? fallback.bannerSourceUrl,
    bannerAttribution: storedMeta?.banner_attribution ?? fallback.bannerAttribution,
    bannerLicense: storedMeta?.banner_license ?? fallback.bannerLicense,
    bannerLicenseUrl: storedMeta?.banner_license_url ?? fallback.bannerLicenseUrl,
    resolverType: storedMeta?.resolver_type ?? fallback.resolverType ?? "price",
    resolutionSource: storedMeta?.resolution_source ?? fallback.resolutionSource,
    backupResolutionSources: storedMeta?.resolution_backup_sources ?? fallback.backupResolutionSources,
    resolutionRules: storedMeta?.resolution_rules ?? fallback.resolutionRules,
    voidRules: storedMeta?.void_rules ?? fallback.voidRules,
    rulesHash: storedMeta?.rules_hash ?? fallback.rulesHash,
  };
  let onchainRulesHash: string | null = null;
  let rulesVerified = meta.resolverType !== "event";
  if (meta.resolverType === "event" && resolverId) {
    onchainRulesHash = await getEventRulesHash(resolverId, marketId).catch(() => null);
    if (meta.title && meta.category && meta.resolutionSource && meta.resolutionRules && meta.voidRules) {
      const computed = eventRulesHashHex({
        title: meta.title,
        category: meta.category,
        resolutionSource: meta.resolutionSource,
        backupResolutionSources: meta.backupResolutionSources,
        resolutionRules: meta.resolutionRules,
        voidRules: meta.voidRules,
      });
      rulesVerified = computed === onchainRulesHash;
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(info.expiry);
  const secondsLeft = Math.max(0, expiry - now);
  const outcomeVal = outcomeLabel(outcome);
  const acceptingOrders = outcomeVal === "LIVE" && secondsLeft > 0;
  return {
    probYes: probFromFixed(priceYes),
    qYes: fixedToNumber(state[0]),
    qNo: fixedToNumber(state[1]),
    outcome: outcomeVal,
    acceptingOrders,
    phase: outcomeVal === "LIVE" && !acceptingOrders ? "CLOSED" : outcomeVal,
    question: meta.title || marketQuestion(info),
    asset: info.asset,
    strike: marketStrike(info),
    poolSize: Number(formatTokenAmount(marketEconomics.poolBalance, collateral.decimals, 7)),
    orderCount: marketEconomics.orderCount,
    collateral,
    feeBps: marketEconomics.feeBps,
    lotSize: marketEconomics.lotSize,
    maximumBatchSize: marketEconomics.maximumBatchSize,
    minimumSideCount: marketEconomics.minimumSideCount,
    expiry,
    finalizeAfter: Number(info.finalize_after ?? info.expiry),
    secondsLeft,
    resolutionLabel: outcomeVal === "LIVE"
      ? acceptingOrders ? formatCountdown(secondsLeft) : "awaiting final batch and resolution"
      : outcomeVal === "VOID" ? "voided and refundable" : "resolved",
    ...meta,
    resolverId,
    onchainRulesHash,
    rulesVerified,
  };
}

export function useMarket() {
  const { marketId, poolId, collateral, descriptor } = useActiveMarket();
  return useQuery({
    queryKey: [
      "market",
      marketId,
      poolId,
      descriptor?.liquidityVaultId ?? "missing-private-vault",
      collateral.sac,
    ],
    refetchInterval: 15000,
    queryFn: async () => {
      if (descriptor?.resolverType !== "event") {
        try {
          const catalog = await getPrivateMarketCatalog();
          const entry = catalog.markets.find((item) => item.market === marketId);
          if (entry) return marketFromPrivateCatalog(entry, collateral, descriptor);
        } catch {
          // Direct Stellar reads remain available during service upgrades.
        }
      }
      return fetchMarket(marketId, poolId, collateral, descriptor);
    },
  });
}
