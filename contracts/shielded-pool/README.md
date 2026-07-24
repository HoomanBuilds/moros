# Shielded Pool (forked)

Commitment/nullifier privacy pool: commitment Merkle tree + Groth16/BLS12-381
verifier + `deposit`/`withdraw`. The basis for confidential positions in the
prediction market.

Forked from [ymcrcat/soroban-privacy-pools](https://github.com/ymcrcat/soroban-privacy-pools)
(MIT - see `LICENSE`). Self-contained sub-workspace pinned to its own `soroban-sdk`
version; excluded from the parent `contracts` workspace.

## Status - market-aware private positions
A note is a **private bet** on one binary market's YES/NO side. `withdraw` proves,
in ZK, ownership of a note on the **winning** side of a **resolved** market and pays
an in-proof recipient. 8 public signals, 9 IC points; power-15 BLS12-381 setup.

- `circuits/main.circom` binds `recipient/relayer/fee` (anti-front-run) **and**
  `side` into the note commitment, exposing `winningOutcome` with `side === winningOutcome`.
- `withdraw`:
  - enforces `recipient == sha256(xdr(to))` (top 3 bits cleared) - no mempool re-targeting;
  - reads the market's resolved outcome cross-contract (`MarketClient.outcome()`),
    requires it resolved, and checks `winningOutcome` matches - a losing-side note
    or an unresolved market is rejected.
- **Per-market pool:** the `market` address is bound at construction, so a note's
  market is the pool it lives in; its side is committed inside the note.
- `deposit` verifies a **bet-validity proof** (`circuits/deposit.circom`, reusing the
  same `CommitmentHasher`): the note is well-formed, `side ∈ {0,1}`, `0 < amount ≤ cap`
  - all without revealing size or side. The contract checks the proof's commitment
  equals the deposited one and its `cap` equals the pool's configured cap.
- **Validated live on testnet** - deploy -> deposit (bet-validity verified on-chain)
  -> resolve -> relayer-submitted withdraw (redeem verified on-chain). See
  This prototype is not part of the canonical shared-vault deployment in
  [`deployments/private-testnet.json`](../../deployments/private-testnet.json).
- Unaudited research code - testnet/demo only.

Follow-ups: variable stake + LMSR-backed payout (winners capture the pot),
batching to hide side/size across trades (Phase 4).

## Regenerating the withdraw proof
See [`tooling/README.md`](tooling/README.md) for the full pipeline (self-run
BLS12-381 ceremony + `stellar-coinutils --side` + `winningOutcome`) and the
`coinutils-side.patch` that binds `side` into the note.

## Build
```
cd contracts/shielded-pool && cargo test
```
