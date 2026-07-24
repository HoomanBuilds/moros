import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";
import type { CollateralAsset } from "@/lib/network";
import { readContract } from "./client";

export async function getMarketState(marketId: string): Promise<[bigint, bigint, bigint]> {
  return readContract(marketId, "get_state");
}
export async function getPriceYes(marketId: string): Promise<bigint> {
  return readContract(marketId, "price_yes");
}
export async function getOutcome(marketId: string): Promise<unknown> {
  return readContract(marketId, "outcome");
}
export async function getMarketInfo(marketId: string): Promise<{ asset: string; threshold: bigint; expiry: bigint; finalize_after?: bigint }> {
  return readContract(marketId, "market_info");
}
export async function getMarketResolver(marketId: string): Promise<string | null> {
  return readContract(marketId, "resolver");
}
export async function getEventRulesHash(resolverId: string, marketId: string): Promise<string | null> {
  const value = await readContract(resolverId, "rules_hash", [nativeToScVal(Address.fromString(marketId), { type: "address" })]);
  return value ? Buffer.from(value).toString("hex") : null;
}
export async function getEventConfig(resolverId: string): Promise<{
  collateral: string;
  bond: bigint;
  challenge_period: bigint;
  committee: string[];
  threshold: number;
}> {
  return readContract(resolverId, "config");
}
export async function getEventProposal(resolverId: string, marketId: string): Promise<unknown | null> {
  return readContract(resolverId, "proposal", [nativeToScVal(Address.fromString(marketId), { type: "address" })]);
}
export async function getClearingPrice(poolId: string): Promise<bigint> {
  return readContract(poolId, "get_price");
}
export async function getFeeConfig(poolId: string): Promise<[string, number]> {
  return readContract(poolId, "fee_config");
}
export async function getPrivateMarketRegistration(
  vaultId: string,
  marketId: string,
): Promise<{
  market: string;
  fee_bps: number;
  lp_fee_share_bps: number;
} | null> {
  const market = nativeToScVal(Address.fromString(marketId), {
    type: "address",
  });
  return readContract(vaultId, "registration", [market]);
}
export async function getPoolMarket(poolId: string): Promise<string> {
  return readContract(poolId, "market");
}
export async function getPoolCollateral(poolId: string): Promise<string> {
  return readContract(poolId, "collateral");
}
export async function getMarketCollateral(marketId: string): Promise<string> {
  return readContract(marketId, "collateral");
}
export async function getOrder(commitmentDec: string, poolId: string): Promise<unknown> {
  const commitment = Buffer.from(BigInt(commitmentDec).toString(16).padStart(64, "0"), "hex");
  return readContract(poolId, "get_order", [nativeToScVal(commitment, { type: "bytes" })]);
}
export async function getPoolBalance(
  poolId: string,
  collateral: CollateralAsset = NETWORK.collateral,
): Promise<bigint> {
  const arg = nativeToScVal(Address.fromString(poolId), { type: "address" });
  return readContract(collateral.sac, "balance", [arg]);
}
