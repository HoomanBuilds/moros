export type Position = {
  address: string; market: string; side: string; amount: string;
  collateralCode?: string;
  secret: string; nullifier: string; commitment: string; txHash: string;
  status: "placed" | "submitted" | "redeemed";
};

const KEY = "umbra.positions.v1";
let mem: Record<string, Position[]> | null = null;

function store(): Record<string, Position[]> {
  if (mem) return mem;
  if (typeof localStorage === "undefined") { mem = {}; return mem; }
  try { mem = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { mem = {}; }
  return mem;
}
function flush() {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(mem));
}
export function _resetForTest(seed: Record<string, Position[]>) { mem = seed; }
export function addPosition(p: Position) {
  const s = store();
  (s[p.address] ||= []).push(p);
  flush();
}
export function listPositions(address: string): Position[] {
  return store()[address] ?? [];
}
export function updateStatus(address: string, commitment: string, status: Position["status"]) {
  const s = store();
  const p = (s[address] ?? []).find((x) => x.commitment === commitment);
  if (!p) return;
  p.status = status;
  flush();
}
export function exportBook(): string { return JSON.stringify(store()); }
export function importBook(json: string) { mem = JSON.parse(json); flush(); }
