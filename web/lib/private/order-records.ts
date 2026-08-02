export async function readOrderedRecords<T extends { sequence: bigint }>({
  firstSequence,
  lastSequence,
  maximumRecords,
  read,
  unavailableMessage,
}: {
  firstSequence: bigint;
  lastSequence: bigint;
  maximumRecords: number;
  read: (sequence: bigint) => Promise<T | undefined>;
  unavailableMessage: string;
}): Promise<T[]> {
  if (
    firstSequence < 0n ||
    lastSequence < firstSequence ||
    !Number.isSafeInteger(maximumRecords) ||
    maximumRecords < 1
  ) {
    throw new Error("Private order range is invalid");
  }
  const count = lastSequence - firstSequence + 1n;
  if (count > BigInt(maximumRecords)) {
    throw new Error("Private order range exceeds the batch limit");
  }
  const sequences = Array.from(
    { length: Number(count) },
    (_, index) => firstSequence + BigInt(index),
  );
  const records = await Promise.all(sequences.map(read));
  return records.map((record, index) => {
    if (!record || record.sequence !== sequences[index]) {
      throw new Error(unavailableMessage);
    }
    return record;
  });
}
