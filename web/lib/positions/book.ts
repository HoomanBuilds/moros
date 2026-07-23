export type PositionStatus = "placed" | "submitted" | "redeemed" | "refunded";

export type Position = {
  address: string;
  market: string;
  pool?: string;
  side: "0" | "1";
  amount: string;
  collateralCode: string;
  stakeAmount: string;
  secret: string;
  nullifier: string;
  commitment: string;
  txHash: string;
  placedAt: number;
  status: PositionStatus;
  backupStatus?: "local" | "synced";
  backupError?: string;
  submissionError?: string;
  settlementTxHash?: string;
  changeTxHash?: string;
  protocol?: "shared-vault";
  privateEpoch?: string;
  privateSequence?: string;
  executionChangeNullifier?: string;
  stakeAmountAtomic?: string;
};

const KEY = "moros.positions";
const LEGACY_KEYS = ["umbra.positions.v1"];
const ADDRESS = /^G[A-Z2-7]{55}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const DECIMAL = /^\d+$/;
const TX_HASH = /^[0-9a-f]{64}$/i;
let mem: Record<string, Position[]> | null = null;
const listeners = new Set<() => void>();

function normalizePosition(value: unknown, fallbackAddress?: string): Position | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const address = String(row.address ?? fallbackAddress ?? "");
  const market = String(row.market ?? "");
  const pool = row.pool ? String(row.pool) : undefined;
  const side = String(row.side ?? "");
  const amount = String(row.amount ?? "");
  const stakeAmount = String(row.stakeAmount ?? amount);
  const secret = String(row.secret ?? "");
  const nullifier = String(row.nullifier ?? "");
  const commitment = String(row.commitment ?? "");
  const txHash = String(row.txHash ?? "");
  const status = String(row.status ?? "placed");
  if (!ADDRESS.test(address) || !CONTRACT.test(market) || (pool && !CONTRACT.test(pool))) return null;
  if (side !== "0" && side !== "1") return null;
  if (![amount, stakeAmount, secret, nullifier, commitment].every((field) => DECIMAL.test(field) && BigInt(field) > 0n)) return null;
  if (!TX_HASH.test(txHash)) return null;
  if (!["placed", "submitted", "redeemed", "refunded"].includes(status)) return null;
  const placedAt = Number(row.placedAt ?? Date.now());
  if (!Number.isFinite(placedAt) || placedAt <= 0) return null;
  const settlementTxHash = row.settlementTxHash ? String(row.settlementTxHash) : undefined;
  if (settlementTxHash && !TX_HASH.test(settlementTxHash)) return null;
  const changeTxHash = row.changeTxHash ? String(row.changeTxHash) : undefined;
  if (changeTxHash && !TX_HASH.test(changeTxHash)) return null;
  const protocol = row.protocol === "shared-vault" ? "shared-vault" : undefined;
  const privateEpoch = row.privateEpoch === undefined
    ? undefined
    : String(row.privateEpoch);
  const privateSequence = row.privateSequence === undefined
    ? undefined
    : String(row.privateSequence);
  const executionChangeNullifier = row.executionChangeNullifier === undefined
    ? undefined
    : String(row.executionChangeNullifier);
  const stakeAmountAtomic = row.stakeAmountAtomic === undefined
    ? undefined
    : String(row.stakeAmountAtomic);
  if (
    protocol &&
    (
      !privateEpoch ||
      !DECIMAL.test(privateEpoch) ||
      !privateSequence ||
      !DECIMAL.test(privateSequence) ||
      BigInt(privateSequence) === 0n ||
      !executionChangeNullifier ||
      !DECIMAL.test(executionChangeNullifier) ||
      BigInt(executionChangeNullifier) === 0n ||
      !stakeAmountAtomic ||
      !DECIMAL.test(stakeAmountAtomic) ||
      BigInt(stakeAmountAtomic) === 0n
    )
  ) {
    return null;
  }
  return {
    address,
    market,
    pool,
    side,
    amount,
    collateralCode: String(row.collateralCode ?? "USDC").toUpperCase(),
    stakeAmount,
    secret,
    nullifier,
    commitment,
    txHash,
    placedAt,
    status: status as PositionStatus,
    backupStatus: row.backupStatus === "synced" ? "synced" : "local",
    backupError: row.backupError ? String(row.backupError) : undefined,
    submissionError: row.submissionError ? String(row.submissionError) : undefined,
    settlementTxHash,
    changeTxHash,
    protocol,
    privateEpoch,
    privateSequence,
    executionChangeNullifier,
    stakeAmountAtomic,
  };
}

function normalizeBook(value: unknown): Record<string, Position[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Position[]> = {};
  for (const [address, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!ADDRESS.test(address) || !Array.isArray(rows)) continue;
    const positions = rows
      .map((row) => normalizePosition(row, address))
      .filter((row): row is Position => row !== null);
    if (positions.length > 0) result[address] = dedupe(positions);
  }
  return result;
}

function dedupe(positions: Position[]): Position[] {
  const byCommitment = new Map<string, Position>();
  for (const position of positions) {
    const existing = byCommitment.get(position.commitment);
    if (!existing || position.placedAt > existing.placedAt) {
      byCommitment.set(position.commitment, position);
      continue;
    }
    if (position.placedAt === existing.placedAt) {
      const rank: Record<PositionStatus, number> = { placed: 0, submitted: 1, redeemed: 2, refunded: 2 };
      if (rank[position.status] > rank[existing.status]) byCommitment.set(position.commitment, position);
    }
  }
  return [...byCommitment.values()].sort((a, b) => b.placedAt - a.placedAt);
}

function readJson(key: string): unknown {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function store(): Record<string, Position[]> {
  if (mem) return mem;
  if (typeof localStorage === "undefined") {
    mem = {};
    return mem;
  }
  const current = readJson(KEY);
  if (current) {
    mem = normalizeBook(current);
    return mem;
  }
  for (const legacyKey of LEGACY_KEYS) {
    const legacy = readJson(legacyKey);
    if (!legacy) continue;
    mem = normalizeBook(legacy);
    flush();
    return mem;
  }
  mem = {};
  return mem;
}

function flush() {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(mem ?? {}));
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribePositions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addPosition(position: Position) {
  const normalized = normalizePosition(position);
  if (!normalized) throw new Error("Private position record is invalid");
  const book = store();
  book[normalized.address] = dedupe([normalized, ...(book[normalized.address] ?? [])]);
  flush();
  emit();
}

export function listPositions(address: string): Position[] {
  return [...(store()[address] ?? [])];
}

export function updatePosition(address: string, commitment: string, update: Partial<Pick<Position, "pool" | "status" | "backupStatus" | "backupError" | "submissionError" | "settlementTxHash" | "changeTxHash">>) {
  const book = store();
  const position = (book[address] ?? []).find((row) => row.commitment === commitment);
  if (!position) return;
  Object.assign(position, update);
  flush();
  emit();
}

export function updateStatus(address: string, commitment: string, status: PositionStatus) {
  updatePosition(address, commitment, { status });
}

export function mergePositions(address: string, positions: Position[]): number {
  const valid = positions
    .map((position) => normalizePosition(position, address))
    .filter((position): position is Position => position !== null && position.address === address);
  const book = store();
  const before = book[address]?.length ?? 0;
  book[address] = dedupe([...(book[address] ?? []), ...valid]);
  flush();
  emit();
  return (book[address]?.length ?? 0) - before;
}

export function exportWallet(address: string): string {
  return JSON.stringify({ address, positions: listPositions(address), exportedAt: Date.now() }, null, 2);
}

export function importWallet(json: string, address: string): number {
  const parsed = JSON.parse(json) as { address?: unknown; positions?: unknown };
  if (parsed.address !== address || !Array.isArray(parsed.positions)) {
    throw new Error("This backup does not belong to the connected wallet");
  }
  return mergePositions(address, parsed.positions as Position[]);
}

export function _resetForTest(seed: Record<string, Position[]> | null) {
  mem = seed;
}
