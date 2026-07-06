# Shielded Pool (forked)

Commitment/nullifier privacy pool: commitment Merkle tree + Groth16/BLS12-381
verifier + `deposit`/`withdraw`. The basis for confidential positions in the
prediction market.

Forked from [ymcrcat/soroban-privacy-pools](https://github.com/ymcrcat/soroban-privacy-pools)
(MIT — see `LICENSE`). Self-contained sub-workspace pinned to its own `soroban-sdk`
version; excluded from the parent `contracts` workspace.

## Status — being adapted for the market
- Notes will carry `market + side`; redeem gated on the market's resolved outcome.
- **NOT deployable yet:** the upstream `withdraw` does not bind the recipient into
  the proof, so it is front-runnable. The `redeem` circuit must bind
  recipient/relayer/fee first. Unaudited research code — testnet/demo only.

## Build
```
cd contracts/shielded-pool && cargo test
```
