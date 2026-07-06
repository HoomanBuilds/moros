# Shielded Pool (forked)

Commitment/nullifier privacy pool: commitment Merkle tree + Groth16/BLS12-381
verifier + `deposit`/`withdraw`. The basis for confidential positions in the
prediction market.

Forked from [ymcrcat/soroban-privacy-pools](https://github.com/ymcrcat/soroban-privacy-pools)
(MIT — see `LICENSE`). Self-contained sub-workspace pinned to its own `soroban-sdk`
version; excluded from the parent `contracts` workspace.

## Status — market-aware private positions
A note is a **private bet** on one binary market's YES/NO side. `withdraw` proves,
in ZK, ownership of a note on the **winning** side of a **resolved** market and pays
an in-proof recipient. 8 public signals, 9 IC points; power-15 BLS12-381 setup.

- `circuits/main.circom` binds `recipient/relayer/fee` (anti-front-run) **and**
  `side` into the note commitment, exposing `winningOutcome` with `side === winningOutcome`.
- `withdraw`:
  - enforces `recipient == sha256(xdr(to))` (top 3 bits cleared) — no mempool re-targeting;
  - reads the market's resolved outcome cross-contract (`MarketClient.outcome()`),
    requires it resolved, and checks `winningOutcome` matches — a losing-side note
    or an unresolved market is rejected.
- **Per-market pool:** the `market` address is bound at construction, so a note's
  market is the pool it lives in; its side is committed inside the note.
- **NOT deployable yet.** Unaudited research code — testnet/demo only.

Follow-ups: `bet_validity` at `deposit` (hidden amount ≤ cap), variable stake +
LMSR-backed payout, batching (Phase 4).

## Regenerating the withdraw proof
See [`tooling/README.md`](tooling/README.md) for the full pipeline (self-run
BLS12-381 ceremony + `stellar-coinutils --side` + `winningOutcome`) and the
`coinutils-side.patch` that binds `side` into the note.

## Build
```
cd contracts/shielded-pool && cargo test
```
