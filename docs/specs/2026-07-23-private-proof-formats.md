# Moros private proof formats

## Status

Implementation draft for the fresh shared-vault testnet deployment.

The balance, recovery-envelope, and private-order formats are implemented and cross-language tested. LP replacement, allocation, and batch formats remain blocked from final freeze until their negative circuit fixtures and resource measurements pass.

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
| 5 | Maximum batch size |
| 6 | Minimum positions per side, fixed to zero |
| 7 | Maximum adverse price movement |
| 8 to 9 | Rules hash limbs |
| 10 | Refund timestamp |
| 11 | Committee key epoch |
| 12 to 13 | Committee configuration hash limbs |
| 14 to 15 | Committee Baby Jubjub public key |
| 16 to 19 | Encrypted order points `C1.x`, `C1.y`, `C2.x`, and `C2.y` |
| 20 | Old accepted-order Merkle root |
| 21 | New accepted-order Merkle root |
| 22 | Accepted leaf index |
| 23 | Public acceptance sequence |

The order circuit spends two liquid notes, permits a zero-value padding input, creates one liquid change note and one position note, and proves exact conservation. The position budget is one atomic-USDC payout per fixed lot plus the maximum fee at `p * (1 - p) = 0.25`.

The hidden side is encrypted with Baby Jubjub ElGamal under the cofactor-cleared committee key. The circuit verifies both configured and generated points, rejects low-order or identity values, binds nonzero encryption randomness, and proves that the ciphertext contains the same Boolean side stored in the position note.

Accepted orders use a depth-6 Poseidon2 Merkle tree with capacity 64, matching the contract batch cap. The order circuit proves a zero-leaf append at the exact contract-assigned index. The contract independently calculates and stores the same root from its bounded frontier. The accepted leaf binds market, epoch, sequence, action ID, position commitment, all four ciphertext coordinates, and committee epoch.

## Refund binding

| Binding index | Field |
| --- | --- |
| 0 | Epoch |
| 1 | Sealed accepted-order Merkle root |
| 2 to 23 | Zero |

Refund, execution-change, and claim calls do not publish an acceptance sequence or position commitment. Their circuits prove private membership under the sealed accepted or allocation root, and their purpose-specific nullifiers prevent reuse.

## Liquidity proof bindings

Liquidity funding, pre-activation exit, and terminal redemption use the liquidity binding:

| Binding index | Field |
| --- | --- |
| 0 to 1 | Market liquidity-vault address limbs |
| 2 | Commitment of the new or remaining LP-share note |
| 3 | Shares minted or burned |
| 4 | USDC assets transferred |
| 5 | Expected liquidity-vault state version |
| 6 to 23 | Zero |

An LP-share note uses purpose `3`, stores its share count as the note amount, and binds `Poseidon2(1011, liquidityVaultHigh, liquidityVaultLow)` as its payload. Funding spends liquid USDC notes, returns liquid change, and creates the exact share note named by the binding. Exit and terminal redemption spend only LP-share notes for that liquidity vault, create the exact public USDC amount as a new shielded balance note, and return any unburned shares in the bound output commitment. A full redemption produces a unique zero-value padding note in the remaining-share slot.

## Allocation binding

| Binding index | Field |
| --- | --- |
| 0 | Epoch |
| 1 | Immutable allocation root |
| 2 | Outcome, where 0 is pending, 1 is YES, 2 is NO, and 3 is VOID |
| 3 | Market state version |
| 4 | Batch size |
| 5 | YES count |
| 6 | NO count |
| 7 | Pre-batch YES price |
| 8 | Post-batch YES price |
| 9 | Uniform YES price |
| 10 | Uniform NO price |
| 11 | Exact aggregate market charge |
| 12 | YES aggregate market cost |
| 13 | NO aggregate market cost |
| 14 | YES charge per position |
| 15 | NO charge per position |
| 16 | Protocol rounding contribution |
| 17 | Fee per position |
| 18 | Refundable fee escrow |
| 19 | Conditional LP fee |
| 20 | Conditional protocol fee |
| 21 | Immutable fixed lot size |
| 22 to 23 | Zero |

The allocation leaf is `Poseidon2(1012, marketHigh, marketLow, epoch, sequence, positionCommitment, side, charge, fee, payout)`. Its depth-6 Merkle proof stays private. The charge is selected from the proof-bound YES or NO charge by the hidden side. The payout is derived from the immutable lot size as `ceil(lotSize * 10^7 / 2^32)`.

Execution-change proofs use nullifier domain `3` and return exactly `positionBudget - charge - fee`. Terminal claim, short-epoch refund, and VOID refund proofs use nullifier domain `4`, so change recovery cannot consume terminal rights and a terminal right cannot be used twice. A winning claim returns the exact lot payout, a losing claim returns only padding, a short-epoch refund returns the complete position budget, and a VOID refund returns the executed charge plus fee. Combined execution change and VOID refund exactly reconstruct the original position budget.

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

An active exit match has 20 public fields. Two of its three nullifier slots consume the replacement LP's shielded USDC notes, while the third slot is fixed to zero. Its four proof-bound outputs are the seller's exact precommitted payment note, the buyer's LP share note, buyer change, and padding.

The seller request consumes one LP share note, creates any retained LP change, and creates a private exit receipt. It also publishes a one-time payment-note template containing a commitment, spend public key, viewing public key, note ID, and blinding. The request circuit proves that this template commits to the exact stated payment amount in the shared vault note domain. A later buyer can encrypt the payment output to that public template without learning the seller's note secrets.

The first testnet active-exit circuit requires a complete fill of one offered lot. A seller who wants to sell fewer shares creates a smaller offer and retains the remainder as a private LP change note. This avoids a multi-party witness in which a later buyer would need the seller's receipt secret to create the next partial-fill receipt.

## Batch public signals

Every batch proof has exactly 45 public field elements in this order:

| Index | Field |
| --- | --- |
| 0 to 1 | Network domain limbs |
| 2 to 3 | Shared vault address digest limbs |
| 4 to 5 | Market address digest limbs |
| 6 | Epoch |
| 7 | Accepted-order Merkle root |
| 8 | Accepted count |
| 9 | First acceptance sequence |
| 10 | Last acceptance sequence |
| 11 | Committee key epoch |
| 12 to 13 | Committee configuration hash limbs |
| 14 to 15 | Committee Baby Jubjub public key |
| 16 to 19 | Aggregate ciphertext points |
| 20 to 21 | Decryption proof hash limbs |
| 22 to 23 | Committee statement hash limbs |
| 24 | Allocation root |
| 25 | Included-position root |
| 26 | Immutable fixed lot size |
| 27 | Market state version |
| 28 | Batch size |
| 29 | YES count |
| 30 | NO count |
| 31 | Pre-batch YES price |
| 32 | Post-batch YES price |
| 33 | Uniform YES price |
| 34 | Uniform NO price |
| 35 | Exact aggregate market charge |
| 36 | YES aggregate market cost |
| 37 | NO aggregate market cost |
| 38 | YES charge per position |
| 39 | NO charge per position |
| 40 | Protocol rounding contribution |
| 41 | Fee per position |
| 42 | Refundable fee escrow |
| 43 | Conditional LP fee |
| 44 | Conditional protocol fee |

The testnet circuit accepts one to eight real orders. It reconstructs every accepted leaf, requires canonical zero metadata for inactive slots, and uses valid encrypted-zero ciphertexts to preserve the fixed proof shape. The circuit proves that the accepted root is complete, decrypts every real Baby Jubjub ciphertext against the configured committee key, derives the exact hidden side quantities, verifies the padded aggregate ciphertext, builds the allocation and included-position roots, derives every fixed-lot payout, and reconciles side charges, rounding, fee escrow, LP fees, and protocol fees. A batch executes when it reaches eight orders or after the 60-second window opened by the first order flow. The relayed epoch opener persists the cutoff and refund deadline before the order proof binds them. Empty windows never move the price.

This testnet proof currently uses the reconstructed committee secret as a private Groth16 witness. It never exposes that secret on-chain, but the proving coordinator can reconstruct it. Production promotion requires the distributed proving or verifiable threshold-decryption replacement described in the committee hardening plan. The single-VM coordinator is not presented as production-safe.

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
