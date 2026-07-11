"use client";
import { useQuery } from "@tanstack/react-query";
import { getMarketState, getPriceYes, getOutcome, getMarketInfo, getPoolBalance } from "./read";
import { probFromFixed, fixedToNumber, outcomeLabel, marketQuestion, formatCountdown } from "./derive";

export function useMarket() {
  return useQuery({
    queryKey: ["market"],
    refetchInterval: 15000,
    queryFn: async () => {
      const [state, priceYes, outcome, info, poolBal] = await Promise.all([
        getMarketState(), getPriceYes(), getOutcome(), getMarketInfo(), getPoolBalance(),
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
        poolSizeXlm: Number(poolBal) / 1e7,
        expiry,
        secondsLeft,
        resolutionLabel: outcomeVal === "LIVE" ? formatCountdown(secondsLeft) : "resolved",
      };
    },
  });
}
