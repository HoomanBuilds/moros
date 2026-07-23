# Stellar Private Payments compatibility decision

## Decision

Moros will adopt the note, transaction, Poseidon2, BN254 Groth16, and recovery model from Stellar Private Payments v0.1.0 through Moros-owned adapters. It will not deploy the upstream application, public key registry, pool contract, or event-only recovery flow unchanged.

Pinned upstream release:

- Repository: https://github.com/NethermindEth/stellar-private-payments
- Tag: `v0.1.0`
- Commit: `9521494be1792003b4fd441404ff971b52dfdda2`
- License: Apache-2.0 for most source, LGPLv3 for the circuit build path, and distribution obligations for generated artifacts

## Current Stellar capability

Official Stellar documentation confirms:

- BN254 and Poseidon/Poseidon2 host functions are available from Protocol 25.
- Protocol 26 adds efficient BN254 operations used by ZK applications.
- Mainnet currently runs Protocol 26.
- Testnet currently runs Protocol 27.
- The Moros core contracts use `soroban-sdk` 26.1.0.
- The pinned upstream release targets `soroban-sdk` 26 and BN254 Groth16.

The installed local ZK skill is stale where it says BN254 and Poseidon are only proposed. Moros will use BN254 and Poseidon2 for new testnet privacy work and will confirm live RPC version information during deployment.

Primary references:

- https://developers.stellar.org/docs/build/apps/privacy
- https://developers.stellar.org/docs/networks/software-versions
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0075.md
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0080.md

## Adopted components

- BN254 Groth16 proof and verification encoding.
- Poseidon2 commitments, Merkle nodes, and nullifiers.
- UTXO-style input ownership and balance conservation.
- Deterministic wallet-derived note and recovery keys.
- Fixed input and output shapes where applicable.
- Client-side browser proving.
- Local witness verification.
- Optional selective-disclosure primitives after separate policy review.

Every adopted component is pinned behind Moros-owned types, public-signal manifests, fixture tests, and contract interfaces. Upstream breaking changes cannot silently alter deployed Moros proof semantics.

## Rejected direct dependencies

Moros will not use the upstream public address-to-private-key registry for private betting or LP actions. That registry publicly links a Stellar wallet to stable shielded keys.

Moros will not rely on seven-day RPC event retention for note recovery. Fixed-length encrypted output envelopes and commitment indices must remain recoverable from persistent contract data or independently verifiable archives.

Moros will not use the upstream contracts unchanged with real assets. The upstream project explicitly remains work in progress and unaudited.

Moros will not copy its complete application or browser database. The Moros activity archive uses opaque, padded, encrypted pages and remains separate from public social identity.

## Moros-specific extensions

The new shared vault must add proof-bound operations for:

- Private market orders.
- Complete sealed batch inclusion.
- Execution change.
- Winning claims.
- Pending and VOID refunds.
- Private LP share notes.
- State-bound replacement LP exits.
- Shielded fee and treasury notes.

Every proof binds the network passphrase, vault, exact USDC SAC, action, current accepted root, nullifiers, output commitments, market context where applicable, expiry, and immutable verification-key domain.

## Testnet and mainnet boundary

Testnet may use a development trusted setup with a visible warning. Mainnet remains blocked until the final circuits have an independent multi-party setup, immutable artifact commitments, resource measurements, negative tests, and an external security review.

Deposits and final withdrawals of Circle USDC remain public Stellar transfers. Activity, ownership, balances, side, change, claims, refunds, and internal links become shielded after deposit.
