# Moros private proof formats

## Status

Implementation draft for the fresh shared-vault testnet deployment.

The balance action formats and recovery envelope are implemented and cross-language tested. Order, LP replacement, allocation, and batch formats remain blocked from final freeze until their negative circuit fixtures and resource measurements pass.

This format uses BN254 Groth16 on Stellar Protocol 26. It does not reuse the legacy BLS12-381 proof artifacts under `web/public/zk`.

## Sources and compatibility

The proof encoding and Poseidon2 parameters are compatible with the Stellar Private Payments v0.1.0 source at commit `9521494be1792003b4fd441404ff971b52dfdda2`.

The Rust operation commitment uses `soroban-poseidon` 26.0.0 and BN254 Poseidon2 with state width 4, rate 3, one capacity element, exponent 5, 8 full rounds, and 56 partial rounds.

Stellar Private Payments is work in progress and unaudited. Moros adopts its reviewed BN254 point encoding, Poseidon2 parameters, and note ownership model through Moros-owned types and contracts. Moros does not adopt its public address registry, its off-circuit X25519 recovery envelope, or assume its deployment is production safe.

The Moros circuits use circomlib 2.0.5 Baby Jubjub components for circuit-verified recovery encryption. The circuit build path and generated artifacts must retain the applicable circomlib license obligations.

## Scalar field encoding

Every field element is an unsigned 32-byte big-endian integer strictly below:

`0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001`

Values equal to or above the modulus are rejected. They are never reduced modulo the field.

Every 32-byte identifier that may be at or above the scalar modulus is split into two 128-bit limbs:

1. Bytes 0 through 15 as an unsigned big-endian integer.
2. Bytes 16 through 31 as an unsigned big-endian integer.

An address is first encoded as Stellar ScVal XDR, hashed with SHA-256, and split using the same rule.

A signed i128 is encoded as:

1. Sign, where 0 is nonnegative and 1 is negative.
2. Unsigned magnitude.

## Operation commitment

Each private action has a 46-field operation context. The contract and prover hash the exact same fields with the Poseidon2 sponge described above.

The common fields are:

| Index | Field |
| --- | --- |
| 0 | Format version, fixed to 1 |
| 1 to 2 | Stellar network domain limbs |
| 3 to 4 | Shared vault address digest limbs |
| 5 to 6 | USDC SAC address digest limbs |
| 7 to 8 | Frozen verifier domain limbs |
| 9 | Action code |
| 10 to 11 | Action ID limbs |
| 12 | Public account present flag |
| 13 to 14 | Public account address digest limbs, or zero |
| 15 | Public amount sign |
| 16 | Public amount magnitude |
| 17 | Market address present flag |
| 18 to 19 | Market address digest limbs, or zero |
| 20 | Expiry ledger timestamp |
| 21 | Binding kind |
| 22 to 45 | Fixed 24-field action binding |

Action codes are:

| Code | Action |
| --- | --- |
| 0 | Deposit |
| 1 | Private transfer |
| 2 | Public withdrawal |
| 3 | Private order |
| 4 | Position claim |
| 5 | Refund |
| 6 | Liquidity fund |
| 7 | Liquidity exit |
| 8 | Terminal liquidity redeem |
| 9 | Execution change |
| 10 | Treasury shielding |
| 11 | Active exit request |
| 12 | Active exit cancellation |
| 13 | Active exit match |

Binding kinds are:

| Code | Binding |
| --- | --- |
| 0 | Empty |
| 1 | Liquidity |
| 2 | Order |
| 3 | Refund |
| 4 | Allocation |
| 5 | Treasury |

Unused binding fields are zero and are still hashed.

## Liquidity binding

| Binding index | Field |
| --- | --- |
| 0 to 1 | Isolated liquidity vault address digest limbs |
| 2 | LP share commitment |
| 3 | LP shares |
| 4 | Expected USDC assets |
| 5 | Liquidity vault state version |
| 6 to 23 | Zero |

## Order binding

| Binding index | Field |
| --- | --- |
| 0 | Epoch |
| 1 | Market state version |
| 2 | Position commitment |
| 3 | Fixed lot size |
| 4 | Fee basis points |
| 5 | Fixed batch size |
| 6 | Minimum positions per side |
| 7 | Maximum adverse price movement |
| 8 to 9 | Rules hash limbs |
| 10 | Refund timestamp |
| 11 | Committee key epoch |
| 12 to 13 | Committee configuration hash limbs |
| 14 to 15 | Canonical encrypted-order hash limbs |
| 16 to 23 | Zero |

## Refund binding

| Binding index | Field |
| --- | --- |
| 0 | Epoch |
| 1 | Acceptance sequence |
| 2 to 3 | Sealed accepted-root limbs |
| 4 | Position commitment |
| 5 to 23 | Zero |

## Allocation binding

| Binding index | Field |
| --- | --- |
| 0 | Epoch |
| 1 | Acceptance sequence |
| 2 | Immutable allocation root |
| 3 | Position commitment |
| 4 | Outcome, where 0 is pending, 1 is YES, 2 is NO, and 3 is VOID |
| 5 | Market state version |
| 6 | Batch size |
| 7 | YES count |
| 8 | NO count |
| 9 | Pre-batch YES price |
| 10 | Post-batch YES price |
| 11 | Uniform YES price |
| 12 | Uniform NO price |
| 13 | Exact aggregate market charge |
| 14 | YES aggregate market cost |
| 15 | NO aggregate market cost |
| 16 | YES charge per position |
| 17 | NO charge per position |
| 18 | Protocol rounding contribution |
| 19 | Fee per position |
| 20 | Refundable fee escrow |
| 21 | Conditional LP fee |
| 22 | Conditional protocol fee |
| 23 | Zero |

## Treasury binding

| Binding index | Field |
| --- | --- |
| 0 to 1 | Treasury shielded-key limbs |
| 2 to 23 | Zero |

## Note and recovery envelope

A note commitment binds:

- The network, shared vault, USDC SAC, and verifier domain.
- Purpose and amount.
- A shielded spending public key.
- A Baby Jubjub recovery public key.
- A random note identifier and blinding.
- A purpose-specific payload hash.
- Two purpose-specific private recovery fields.

The encrypted recovery envelope contains exactly 15 canonical BN254 scalar fields, serialized as 480 big-endian bytes:

| Envelope index | Field |
| --- | --- |
| 0 | Format version, fixed to 1 |
| 1 to 2 | Ephemeral Baby Jubjub public key |
| 3 | Nonce |
| 4 to 13 | Ten encrypted note fields |
| 14 | Poseidon2 authentication tag |

The circuit validates the recipient point, clears its cofactor, rejects the identity, derives an ephemeral public key and ECDH shared point from a nonzero 248-bit secret, generates domain-separated Poseidon2 pads, verifies all ciphertext fields, and verifies the authentication tag. The public envelope commitment is `Poseidon2(1008, envelope[0..14])`.

The contract rejects a wrong length, wrong version, noncanonical field, or envelope commitment mismatch before storing the fixed-size bytes. This prevents both a relayer and the original prover from replacing the recovery payload with ciphertext that does not match the committed note.

## Action public signals

Standard action proofs have exactly 15 public field elements in this order:

| Index | Field |
| --- | --- |
| 0 | Action code |
| 1 | Poseidon2 operation-context commitment |
| 2 | Accepted membership root |
| 3 | Current append root |
| 4 | New root after two outputs |
| 5 | Input nullifier count |
| 6 | First input nullifier, or zero padding |
| 7 | Second input nullifier, or zero padding |
| 8 | First output commitment |
| 9 | Second output commitment |
| 10 | First fixed-size encrypted-output Poseidon2 commitment |
| 11 | Second fixed-size encrypted-output Poseidon2 commitment |
| 12 | First output leaf index |
| 13 | Public amount sign |
| 14 | Public amount magnitude |

The two outputs are always present. A padding output has zero economic value but a unique nonzero commitment and fixed-size encrypted envelope.

An active exit match has 20 public fields. It uses three nullifier slots and four proof-bound outputs so a partial fill can create seller payment, buyer LP shares, buyer change, and a remaining exit note without revealing their owners.

## Batch public signals

Every batch proof has exactly 40 public field elements in this order:

| Index | Field |
| --- | --- |
| 0 to 1 | Network domain limbs |
| 2 to 3 | Shared vault address digest limbs |
| 4 to 5 | Market address digest limbs |
| 6 | Epoch |
| 7 to 8 | Accepted-root limbs |
| 9 | Accepted count |
| 10 | First acceptance sequence |
| 11 | Last acceptance sequence |
| 12 | Committee key epoch |
| 13 to 14 | Committee configuration hash limbs |
| 15 to 16 | Aggregate ciphertext hash limbs |
| 17 to 18 | Decryption proof hash limbs |
| 19 to 20 | Committee statement hash limbs |
| 21 | Allocation root |
| 22 | Market state version |
| 23 | Batch size |
| 24 | YES count |
| 25 | NO count |
| 26 | Pre-batch YES price |
| 27 | Post-batch YES price |
| 28 | Uniform YES price |
| 29 | Uniform NO price |
| 30 | Exact aggregate market charge |
| 31 | YES aggregate market cost |
| 32 | NO aggregate market cost |
| 33 | YES charge per position |
| 34 | NO charge per position |
| 35 | Protocol rounding contribution |
| 36 | Fee per position |
| 37 | Refundable fee escrow |
| 38 | Conditional LP fee |
| 39 | Conditional protocol fee |

## Groth16 proof encoding

The proof is exactly 256 bytes:

1. A as G1, 64 bytes.
2. B as G2, 128 bytes.
3. C as G1, 64 bytes.

G1 is `X || Y`, with each coordinate as a 32-byte big-endian BN254 base-field element.

G2 is `X.c1 || X.c0 || Y.c1 || Y.c0`, with each component as a 32-byte big-endian BN254 base-field element.

Zero points, noncanonical coordinates, off-curve points, wrong-subgroup G2 points, wrong proof lengths, and verification-key mismatches fail.

## Verifier deployment

Verification keys are uploaded one per transaction in circuit-code order. The verifier accepts exactly 15 keys, computes a rolling SHA-256 domain over every schema hash and complete key, and then finalizes permanently.

The setup controller is deleted at finalization. No key can be added, replaced, or removed afterward. The shared vault constructor accepts only a finalized verifier and stores the exact frozen domain.

## Artifact manifest

Each deployed circuit manifest must record:

- Circuit name and action code.
- Source commit and source SHA-256.
- Circom compiler version.
- circomlib source commit when used.
- R1CS SHA-256.
- WASM SHA-256.
- Proving-key SHA-256.
- Verification-key SHA-256.
- Public-signal schema SHA-256.
- Reproducible build command.
- Testnet-only trusted setup label.

Mainnet keys require an independent ceremony or an independently reviewed setup process. Testnet development keys must never be described as mainnet ready.
