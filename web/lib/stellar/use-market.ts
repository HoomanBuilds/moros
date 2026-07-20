"use client";
import { useQuery } from "@tanstack/react-query";
import { getMarketState, getPriceYes, getOutcome, getMarketInfo, getPoolBalance } from "./read";
import { probFromFixed, fixedToNumber, outcomeLabel, marketQuestion, marketStrike, formatCountdown } from "./derive";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK, type CollateralAsset } from "@/lib/network";
import { formatTokenAmount } from "./amount";

export async function fetchMarket(
  marketId: string,
  poolId: string,
  collateral: CollateralAsset = NETWORK.legacyCollateral,
) {
  const [state, priceYes, outcome, info, poolBal] = await Promise.all([
    getMarketState(marketId),
    getPriceYes(marketId),
    getOutcome(marketId),
    getMarketInfo(marketId),
    getPoolBalance(poolId, collateral),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(info.expiry);
  const secondsLeft = Math.max(0, expiry - now);
  const outcomeVal = outcomeLabel(outcome);
  return {
    probYes: probFromFixed(priceYes),
    qYes: fixedToNumber(state[0]),
    qNo: fixedToNumber(state[1]),
    outcome: outcomeVal,
    question: marketQuestion(info),
    asset: info.asset,
    strike: marketStrike(info),
    poolSize: Number(formatTokenAmount(poolBal, collateral.decimals, 7)),
    collateral,
    expiry,
    secondsLeft,
    resolutionLabel: outcomeVal === "LIVE" ? formatCountdown(secondsLeft) : "resolved",
  };
}

export function useMarket() {
  const { marketId, poolId, collateral } = useActiveMarket();
  return useQuery({
    queryKey: ["market", marketId, collateral.sac],
    refetchInterval: 15000,
    queryFn: () => fetchMarket(marketId, poolId, collateral),
  });
}
