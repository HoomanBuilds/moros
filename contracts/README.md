# Moros payment contracts

| Package | Responsibility |
| --- | --- |
| `payment-types` | Payment statements, action contexts, identities, fees, relay quotes, and shared cryptographic types |
| `payment-vault` | Circle USDC custody, private notes, commitments, nullifiers, and payment action verification |
| `payment-verifier` | Verification keys and BN254 Groth16 verification for the seven payment circuits |
| `payment-circuits` | Circom source and the required Poseidon2, note, Merkle, and encryption primitives |

`payment-types/src/crypto.rs` contains the field, point, envelope, and hashing primitives used by the payment contracts. Circuit identifiers, domains, signal order, and cryptographic constants remain consistent with existing deployments.

```bash
cargo test --manifest-path contracts/Cargo.toml --workspace
```

Release settings retain overflow checks, size optimization, LTO, and symbol stripping. Existing deployment and proving records are in `../deployments/payments-mainnet.json` and `../deployments/payments-mainnet-proving.json`.

Vendored Poseidon2 source retains its upstream license and notices under `payment-circuits/vendor/stellar-private-payments/`.
