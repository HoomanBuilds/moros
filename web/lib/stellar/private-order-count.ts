export type PrivateOrderEpochCursor = {
  accepted_count: number;
  last_sequence: bigint;
};

export function privateOrderCountFromEpochs({
  currentEpochNumber,
  currentEpoch,
  previousEpoch,
}: {
  currentEpochNumber: bigint;
  currentEpoch: PrivateOrderEpochCursor | null;
  previousEpoch?: PrivateOrderEpochCursor | null;
}): number {
  const latestSequence = currentEpoch?.last_sequence && currentEpoch.last_sequence > 0n
    ? currentEpoch.last_sequence
    : currentEpochNumber > 0n
      ? previousEpoch?.last_sequence ?? 0n
      : 0n;
  if (latestSequence > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Private order count exceeds the supported display range");
  }
  return Number(latestSequence);
}
