import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import { readContract } from "./client";

export async function getMarketState(): Promise<[bigint, bigint, bigint]> {
  return readContract(NETWORK.marketId, "get_state");
}
export async function getPriceYes(): Promise<bigint> {
  return readContract(NETWORK.marketId, "price_yes");
}
export async function getOutcome(): Promise<unknown> {
  return readContract(NETWORK.marketId, "outcome");
}
export async function getMarketInfo(): Promise<{ asset: string; threshold: bigint; expiry: bigint }> {
  return readContract(NETWORK.marketId, "market_info");
}
export async function getPoolBalance(): Promise<bigint> {
  const arg = nativeToScVal(Address.fromString(NETWORK.marketId), { type: "address" });
  return readContract(NETWORK.xlmSac, "balance", [arg]);
}
