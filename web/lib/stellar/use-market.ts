"use client";
import { useQuery } from "@tanstack/react-query";
import { getMarketState, getPriceYes, getOutcome, getMarketInfo, getPoolBalance } from "./read";
import { probFromFixed, fixedToNumber, outcomeLabel, marketQuestion, marketStrike, formatCountdown } from "./derive";
import { useActiveMarket } from "@/lib/markets/market-context";

export async function fetchMarket(marketId: string, poolId: string) {
  const [state, priceYes, outcome, info, poolBal] = await Promise.all([
    getMarketState(marketId),
    getPriceYes(marketId),
    getOutcome(marketId),
    getMarketInfo(marketId),
    getPoolBalance(poolId),
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
    poolSizeXlm: Number(poolBal) / 1e7,
    expiry,
    secondsLeft,
    resolutionLabel: outcomeVal === "LIVE" ? formatCountdown(secondsLeft) : "resolved",
  };
}

export function useMarket() {
  const { marketId, poolId } = useActiveMarket();
  return useQuery({
    queryKey: ["market", marketId],
    refetchInterval: 15000,
    queryFn: () => fetchMarket(marketId, poolId),
  });
}
