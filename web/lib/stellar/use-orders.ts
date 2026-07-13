"use client";
import { useQuery } from "@tanstack/react-query";
import { getRecentOrders, type ShieldedOrder } from "./events";

export function useOrders() {
  return useQuery<ShieldedOrder[]>({
    queryKey: ["orders"],
    refetchInterval: 20000,
    retry: 1,
    queryFn: () => getRecentOrders(30),
  });
}
