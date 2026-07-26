import { getPrivateOrderRecord } from "./read";

export type ShieldedOrder = {
  index: number;
  commitment: string;
  at: number;
};

function commitmentHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export async function getRecentOrders(
  limit: number,
  vaultId: string,
  marketId: string,
  orderCount: number,
): Promise<ShieldedOrder[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 0), 30);
  const first = Math.max(1, orderCount - safeLimit + 1);
  const sequences = Array.from(
    { length: Math.max(0, orderCount - first + 1) },
    (_, index) => BigInt(first + index),
  );
  const records = await Promise.all(
    sequences.map((sequence) =>
      getPrivateOrderRecord(vaultId, marketId, sequence)
    ),
  );
  return records
    .filter((record) => record !== null)
    .map((record) => ({
      index: Number(record.sequence),
      commitment: commitmentHex(record.position_commitment),
      at: Number(record.accepted_at) * 1_000,
    }))
    .sort((a, b) => b.index - a.index);
}
