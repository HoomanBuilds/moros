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
| _(next)_ `groth16-verifier` | BLS12-381 Groth16 proof verifier | planned |
| _(next)_ `shielded-pool` | commitment/nullifier notes, deposit/withdraw | planned |
| _(next)_ `resolver` | Reflector (SEP-40) outcome resolution | planned |

`overflow-checks` is **on** in the release profile (a solvency safeguard). The LMSR
fixed-point `exp`/`ln` math was validated on testnet before being ported here.
