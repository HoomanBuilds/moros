# Contracts (Soroban / Rust)

Independently-built Cargo workspace of the on-chain contracts. Build target is
**`wasm32v1-none`** (Rust 1.84+ / current stable — `wasm32-unknown-unknown` is
unsupported by the SDK on recent Rust).

```
stellar contract build      # build all member crates to wasm32v1-none
cargo test                  # native tests via the Soroban test env
```

## Members
| Crate | Contract | Status |
|---|---|---|
| `lmsr-market` | LMSR pricing + market state (YES/NO quantities, cost, price) | in progress |
| `market-liquidity-vault` | Isolated permissionless LP funding, exits, and terminal redemption | implemented, integration pending |
| `shielded-collateral-vault` | Shared USDC notes, nullifiers, durable recovery outputs, and private LP routing | implemented, proof artifacts pending |
| `resolver` | Quorum price resolution with free SEP-40 feeds and optional Pyth verification | implemented |
| `event-resolver` | Bonded evidence, challenges, committee arbitration, and timeout voids | implemented |
| `groth16-verifier` | BN254 Groth16 proof verifier with immutable verification keys | planned |

`overflow-checks` is **on** in the release profile (a solvency safeguard). The LMSR
fixed-point `exp`/`ln` math was validated on testnet before being ported here.
