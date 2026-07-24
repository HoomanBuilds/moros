# Contracts (Soroban / Rust)

Independently-built Cargo workspace of the on-chain contracts. Build target is
**`wasm32v1-none`** (Rust 1.84+ / current stable; `wasm32-unknown-unknown` is
unsupported by the SDK on recent Rust).

```
stellar contract build      # build all member crates to wasm32v1-none
cargo test                  # native tests via the Soroban test env
```

## Members
| Crate | Contract | Status |
|---|---|---|
| `lmsr-market` | LMSR pricing, uniform batches, lifecycle, resolution, and LP accounting | deployed on testnet |
| `market-factory` | Creator-free proposals, deterministic deployment, capability gates, and LP-backed activation | deployed on testnet |
| `market-liquidity-vault` | Isolated market funding, exits, and terminal redemption | deployed on testnet |
| `pooled-liquidity-vault` | Shared LP shares, risk limits, allocation, NAV, withdrawals, and harvests | deployed on testnet |
| `shielded-collateral-vault` | Reusable private USDC notes, orders, claims, refunds, LP actions, outputs, and nullifiers | deployed on testnet |
| `zk-verifier` | BN254 Groth16 proof verification with immutable typed keys | deployed on testnet |
| `resolver` | Free SEP-40 price resolution, optional Pyth verification, and stale-market voiding | deployed on testnet |
| `event-resolver` | Bonded evidence, challenges, arbitration, and timeout voiding | inactive foundation |
| `privacy-types` | Shared proof statements, operation bindings, and verification key types | library |

`overflow-checks` is **on** in the release profile (a solvency safeguard). The LMSR
fixed-point `exp`/`ln` math was validated on testnet before being ported here.
