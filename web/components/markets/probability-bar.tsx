"use client";

const YES = "#16c784";
const NO = "#f0564a";

export function ProbabilityBar({ probYes, showLabels = true }: { probYes: number | null; showLabels?: boolean }) {
  const yes = probYes === null ? 50 : Math.round(probYes * 100);
  const no = 100 - yes;
  return (
    <div className="space-y-2">
      {showLabels && (
        <div className="flex items-center justify-between font-mono text-xs">
          <span style={{ color: YES }}>YES {probYes === null ? "--" : `${yes}%`}</span>
          <span style={{ color: NO }}>NO {probYes === null ? "--" : `${no}%`}</span>
        </div>
      )}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div style={{ width: `${yes}%`, backgroundColor: YES }} className="h-full transition-all duration-500" />
        <div style={{ width: `${no}%`, backgroundColor: NO }} className="h-full transition-all duration-500" />
      </div>
    </div>
  );
}
