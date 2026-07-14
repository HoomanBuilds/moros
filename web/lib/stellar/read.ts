import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { readContract } from "./client";

export async function getMarketState(marketId: string = NETWORK.marketId): Promise<[bigint, bigint, bigint]> {
  return readContract(marketId, "get_state");
}
export async function getPriceYes(marketId: string = NETWORK.marketId): Promise<bigint> {
  return readContract(marketId, "price_yes");
}
export async function getOutcome(marketId: string = NETWORK.marketId): Promise<unknown> {
  return readContract(marketId, "outcome");
}
export async function getMarketInfo(marketId: string = NETWORK.marketId): Promise<{ asset: string; threshold: bigint; expiry: bigint }> {
  return readContract(marketId, "market_info");
}
export async function getClearingPrice(poolId: string = NETWORK.poolId): Promise<bigint> {
  return readContract(poolId, "get_price");
}
export async function getPoolBalance(poolId: string = NETWORK.poolId): Promise<bigint> {
  const arg = nativeToScVal(Address.fromString(poolId), { type: "address" });
  return readContract(NETWORK.xlmSac, "balance", [arg]);
}
