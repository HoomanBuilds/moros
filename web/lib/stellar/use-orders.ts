"use client";
import { useQuery } from "@tanstack/react-query";
import { getRecentOrders, type ShieldedOrder } from "./events";
import { useActiveMarket } from "@/lib/markets/market-context";

export function useOrders() {
  const { poolId } = useActiveMarket();
  return useQuery<ShieldedOrder[]>({
    queryKey: ["orders", poolId],
    refetchInterval: 20000,
    retry: 1,
    queryFn: () => getRecentOrders(30, poolId),
  });
}
