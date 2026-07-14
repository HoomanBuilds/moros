import type { MarketRow } from "./catalog";

export type SortId = "ending" | "pool" | "yesHigh" | "yesLow";

export const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: "ending", label: "Ending soon" },
  { id: "pool", label: "Largest pool" },
  { id: "yesHigh", label: "Highest YES price" },
  { id: "yesLow", label: "Lowest YES price" },
];

export function sortRows(rows: MarketRow[], sort: SortId): MarketRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case "ending":
        return a.secondsLeft - b.secondsLeft;
      case "pool":
        return b.poolXlm - a.poolXlm;
      case "yesHigh":
        return (b.yesCents ?? 0) - (a.yesCents ?? 0);
      case "yesLow":
        return (a.yesCents ?? 0) - (b.yesCents ?? 0);
      default:
        return 0;
    }
  });
  return copy;
}
