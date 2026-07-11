export function appendSample(series: [number, number][], prob: number, ts: number, cap: number): [number, number][] {
  const next: [number, number][] = [...series, [ts, prob]];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
