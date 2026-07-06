# Shielded Pool (forked)

Commitment/nullifier privacy pool: commitment Merkle tree + Groth16/BLS12-381
verifier + `deposit`/`withdraw`. The basis for confidential positions in the
prediction market.

Forked from [ymcrcat/soroban-privacy-pools](https://github.com/ymcrcat/soroban-privacy-pools)
(MIT — see `LICENSE`). Self-contained sub-workspace pinned to its own `soroban-sdk`
version; excluded from the parent `contracts` workspace.

## Status — being adapted for the market
- `circuits/main.circom` now **binds recipient/relayer/fee** (anti-front-run fix).
- Pending wiring: regenerate the withdraw VK from the fixed circuit, update
  `withdraw` to verify `recipient == to`, and regenerate the embedded test proofs.
- Pending market adaptation: notes carry `market + side`; redeem gated on the
  market's resolved outcome.
- **NOT deployable yet.** Unaudited research code — testnet/demo only.

## Build
```
cd contracts/shielded-pool && cargo test
```
