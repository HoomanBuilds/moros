"use client";
import { useQuery } from "@tanstack/react-query";
import { getRecentOrders, type ShieldedOrder } from "./private-orders";
import { useActiveMarket } from "@/lib/markets/market-context";
import { useMarket } from "./use-market";

export function useOrders() {
  const { marketId, poolId } = useActiveMarket();
  const { data: market } = useMarket();
  return useQuery<ShieldedOrder[]>({
    queryKey: ["orders", poolId, marketId, market?.orderCount ?? "loading"],
    enabled: market !== undefined,
    refetchInterval: 20000,
    retry: 1,
    queryFn: () => getRecentOrders(
      30,
      poolId,
      marketId,
      market?.orderCount ?? 0,
    ),
  });
}
