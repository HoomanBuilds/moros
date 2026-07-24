"use client";
import { useQuery } from "@tanstack/react-query";
import { getMarketState, getPriceYes, getOutcome, getMarketInfo, getPoolBalance, getMarketResolver, getEventRulesHash, getFeeConfig, getPrivateMarketRegistration } from "./read";
import { probFromFixed, fixedToNumber, outcomeLabel, marketQuestion, marketStrike, formatCountdown } from "./derive";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK, type CollateralAsset } from "@/lib/network";
import { formatTokenAmount } from "./amount";
import { getMarketMeta } from "@/lib/supabase/markets-meta";
import type { MarketDescriptor } from "@/lib/markets/market-context";
import { eventRulesHashHex } from "@/lib/markets/rules";
import { marketReadPlan } from "@/lib/markets/market-read-plan";

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
      ]).then(([poolBalance, registration]) => {
        if (!registration || registration.market !== marketId) {
          throw new Error("Private market registration is unavailable");
        }
        return {
          poolBalance,
          feeBps: registration.fee_bps,
          lotSize: fixedToNumber(registration.lot_size),
          fixedBatchSize: registration.fixed_batch_size,
          minimumSideCount: registration.minimum_side_count,
        };
      })
    : Promise.all([
        getPoolBalance(readPlan.balanceOwner, collateral),
        getFeeConfig(poolId),
      ]).then(([poolBalance, feeConfig]) => ({
        poolBalance,
        feeBps: Number(feeConfig[1]),
        lotSize: 1,
        fixedBatchSize: null,
        minimumSideCount: null,
      }));
  const [state, priceYes, outcome, info, storedMeta, resolverId, marketEconomics] = await Promise.all([
    getMarketState(marketId),
    getPriceYes(marketId),
    getOutcome(marketId),
    getMarketInfo(marketId),
    getMarketMeta(marketId).catch(() => null),
    getMarketResolver(marketId).catch(() => null),
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
    collateral,
    feeBps: marketEconomics.feeBps,
    lotSize: marketEconomics.lotSize,
    fixedBatchSize: marketEconomics.fixedBatchSize,
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
    queryFn: () => fetchMarket(marketId, poolId, collateral, descriptor),
  });
}
