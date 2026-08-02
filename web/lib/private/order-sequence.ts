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

export async function bindPrivateOrderSequence<
  Candidate,
  Binding extends { sequence: bigint },
>({
  initialSequence,
  build,
  read,
}: {
  initialSequence: bigint;
  build: (sequence: bigint) => Candidate;
  read: (candidate: Candidate) => Promise<Binding>;
}): Promise<{
  sequence: bigint;
  candidate: Candidate;
  binding: Binding;
}> {
  const result = await preparePrivateOrderSequence({
    initialSequence,
    build,
    read,
    prepare: async () => undefined,
  });
  return {
    sequence: result.sequence,
    candidate: result.candidate,
    binding: result.binding,
  };
}

export async function preparePrivateOrderSequence<
  Candidate,
  Binding extends { sequence: bigint },
  Prepared,
>({
  initialSequence,
  build,
  read,
  prepare,
}: {
  initialSequence: bigint;
  build: (sequence: bigint) => Candidate;
  read: (candidate: Candidate) => Promise<Binding>;
  prepare: (candidate: Candidate, sequence: bigint) => Promise<Prepared>;
}): Promise<{
  sequence: bigint;
  candidate: Candidate;
  binding: Binding;
  prepared: Prepared;
}> {
  let sequence = initialSequence;
  let candidate = build(sequence);
  let [binding, prepared] = await Promise.all([
    read(candidate),
    prepare(candidate, sequence),
  ]);
  if (binding.sequence !== sequence) {
    sequence = binding.sequence;
    candidate = build(sequence);
    [binding, prepared] = await Promise.all([
      read(candidate),
      prepare(candidate, sequence),
    ]);
  }
  if (binding.sequence !== sequence) {
    throw new Error("Private order sequence changed while binding the order");
  }
  return { sequence, candidate, binding, prepared };
}
