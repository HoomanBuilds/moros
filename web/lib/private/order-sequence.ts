export type PrivateEpochSequence = {
  epoch: bigint;
  accepted_count: number;
  last_sequence: bigint;
};

export function nextPrivateOrderSequence(
  current: PrivateEpochSequence,
  priorEpochs: PrivateEpochSequence[],
): bigint {
  if (current.accepted_count > 0) return current.last_sequence + 1n;
  for (const prior of priorEpochs) {
    if (prior.last_sequence > 0n) return prior.last_sequence + 1n;
  }
  return 1n;
}
