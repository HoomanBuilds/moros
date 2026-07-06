# Shielded Pool (forked)

Commitment/nullifier privacy pool: commitment Merkle tree + Groth16/BLS12-381
verifier + `deposit`/`withdraw`. The basis for confidential positions in the
prediction market.

Forked from [ymcrcat/soroban-privacy-pools](https://github.com/ymcrcat/soroban-privacy-pools)
(MIT — see `LICENSE`). Self-contained sub-workspace pinned to its own `soroban-sdk`
version; excluded from the parent `contracts` workspace.

## Status — being adapted for the market
- `circuits/main.circom` **binds recipient/relayer/fee** (anti-front-run fix), with
  a fresh BLS12-381 trusted setup (7 public signals, 8 IC points).
- `withdraw` enforces `recipient == sha256(xdr(to))` (top 3 bits cleared) so a
  proof cannot be re-targeted in the mempool; embedded test VK/proofs regenerated.
- Pending market adaptation: notes carry `market + side`; redeem gated on the
  market's resolved outcome.
- **NOT deployable yet.** Unaudited research code — testnet/demo only.

## Regenerating the withdraw proof
Trusted setup + proving live under `circuits/` (artifacts git-ignored). The
CLIs are `stellar-coinutils` / `stellar-circom2soroban` (built from the upstream
fork). `recipient` must equal the contract's `recipient_field(to)` — derive it
from a `recipient_field` unit test, then feed it into `withdrawal_input.json`
before witness generation.

## Build
```
cd contracts/shielded-pool && cargo test
```
