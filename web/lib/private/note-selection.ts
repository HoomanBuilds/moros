export type LiquidPrivateNote = {
  purpose: bigint;
  amount: bigint;
  commitment: bigint;
};

export function isLiquidPrivateNote(
  note: LiquidPrivateNote,
): boolean {
  return [1n, 6n, 7n].includes(note.purpose) && note.amount > 0n;
}

export function liquidPrivateTotal(
  notes: LiquidPrivateNote[],
): bigint {
  return notes
    .filter(isLiquidPrivateNote)
    .reduce((total, note) => total + note.amount, 0n);
}

export function selectSmallestSufficientNote<Note extends LiquidPrivateNote>(
  notes: Note[],
  amount: bigint,
): Note | undefined {
  return notes
    .filter((note) => isLiquidPrivateNote(note) && note.amount >= amount)
    .sort((left, right) => {
      if (left.amount !== right.amount) return left.amount < right.amount ? -1 : 1;
      return left.commitment < right.commitment ? -1 : 1;
    })[0];
}

export function selectConsolidationPair<Note extends LiquidPrivateNote>(
  notes: Note[],
): [Note, Note] | undefined {
  const candidates = notes
    .filter(isLiquidPrivateNote)
    .sort((left, right) => {
      if (left.amount !== right.amount) return left.amount > right.amount ? -1 : 1;
      return left.commitment < right.commitment ? -1 : 1;
    });
  if (candidates.length < 2) return undefined;
  return [candidates[0], candidates[1]];
}
