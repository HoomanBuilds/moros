"use client";
import { useQuery } from "@tanstack/react-query";
import { getAssetCandles, spotFromCandles, type Candle, type Spot } from "./asset-price";

export function useAssetPrice(asset: string | undefined) {
  const query = useQuery<Candle[]>({
    queryKey: ["asset-price", asset],
    enabled: !!asset,
    refetchInterval: 15000,
    retry: 1,
    queryFn: () => getAssetCandles(asset as string),
  });
  const candles = query.data ?? [];
  const spot: Spot | null = spotFromCandles(candles);
  return { candles, spot, isLoading: query.isLoading, isError: query.isError };
}
