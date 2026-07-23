import assert from "node:assert/strict";
import {
  liquidPrivateTotal,
  selectConsolidationPair,
  selectSmallestSufficientNote,
} from "./note-selection.ts";

const notes = [
  { purpose: 1n, amount: 4n, commitment: 4n },
  { purpose: 1n, amount: 9n, commitment: 9n },
  { purpose: 6n, amount: 7n, commitment: 7n },
  { purpose: 0n, amount: 0n, commitment: 1n },
  { purpose: 3n, amount: 100n, commitment: 100n },
];

assert.equal(liquidPrivateTotal(notes), 20n);
assert.equal(selectSmallestSufficientNote(notes, 6n)?.amount, 7n);
assert.equal(selectSmallestSufficientNote(notes, 10n), undefined);
assert.deepEqual(
  selectConsolidationPair(notes)?.map((note) => note.amount),
  [9n, 7n],
);
assert.equal(selectConsolidationPair([notes[0]]), undefined);

console.log("private note selection ok");
