# Reusable private balance and variable position specification

## Status

Required correction before the shared-vault testnet can be called ready.

This specification extends:

- `docs/specs/2026-07-22-shielded-collateral-privacy.md`
- `docs/specs/2026-07-23-permissionless-liquidity-and-private-batch-pricing.md`

Where those documents require one fixed position per private order, this document replaces that restriction with a private whole-position quantity. It also closes the note-fragmentation and committee-secret gaps found during implementation review.

## User outcome

A user can:

1. Add any supported USDC amount to one private balance in Portfolio.
2. Reuse that balance across every supported Moros market.
3. Choose YES or NO and a whole position quantity.
4. Fund LP positions from the same private balance.
5. Receive change, claims, refunds, LP exits, and LP redemptions back into the same private balance.
6. Withdraw any available private USDC to a public Stellar wallet.

The wallet must not open for each private bet or LP allocation. The wallet is used for public deposit, public withdrawal, and deterministic local recovery unlock.

## Current blocking gaps

The current deployed shared-vault flow is not sufficient:

- The order proof consumes two private notes and returns only one spendable balance note.
- The LP funding proof has the same note-fragmentation behavior.
- A balance can remain numerically positive while no valid input pair exists for the next action.
- The bet panel exposes only one fixed position.
- The order ciphertext contains only the side.
- The batch prover receives one combined committee secret and can decrypt each order.
- A combined committee secret on one coordinator defeats the intended threshold trust boundary.

UI changes alone cannot close these gaps.

## Privacy boundary

### Public

- Public Stellar deposit wallet, amount, and time.
- Public Stellar withdrawal recipient, amount, and time.
- Target market and order timing seen by the relayer and public contract.
- Batch order count.
- Aggregate YES count and NO count.
- Aggregate YES quantity and NO quantity after a valid batch executes.
- Confirmed aggregate market price, cost, fees, and price movement.
- Public LP funding delta and target market.

### Private

- Owner of the private balance note.
- Current private balance.
- Individual order side.
- Individual order quantity.
- Individual order charge, change, claim, or refund.
- Link from a deposit to a bet, LP allocation, claim, refund, or withdrawal, subject to timing and anonymity-set limits.
- Plaintext portfolio and private balance from Supabase operators.

### Honest limitations

- A unique deposit followed immediately by a unique action can be correlated by timing.
- Public aggregate quantities may narrow possible individual quantities in a sparse batch.
- The relayer sees the target market and request timing.
- A threshold quorum can violate privacy if it deliberately collaborates to decrypt individual ciphertexts.
- Testnet committee members on one VM do not provide operational independence even when they hold separate cryptographic shares.
- Public withdrawals can be correlated by unique amount and timing.

## Reusable note model

### Deposit output

A deposit creates:

- One positive balance note containing the full deposited amount.
- One zero-value padding note required by the fixed output shape.

Deposits do not split value into two positive notes.

### One-input actions

Order placement, LP funding, and public withdrawal consume one positive liquid note and produce:

- One private balance change note, or padding when change is zero.
- One action-specific note or padding.

Because the next change note is itself a valid one-input note, the remaining balance stays usable after every action.

### Consolidation

Claims, refunds, and LP exits may create multiple positive liquid notes. A private self-transfer consumes two liquid notes and creates:

- One consolidated positive balance note equal to their sum.
- One zero-value padding note.

The browser performs consolidation only when no single note covers the requested action. Consolidation is relayed, does not use the public wallet, and does not expose note values.

### Selection rule

For an action amount `A`:

1. Prefer the smallest single liquid note with value at least `A`.
2. If none exists, consolidate the two smallest liquid notes whose combined value improves the largest available note.
3. Refresh and verify chain state after each consolidation.
4. Stop when one note covers `A`.
5. Fail before proving when the total private balance is below `A`.

The browser must never display a balance as spendable when note selection cannot produce a valid proof path.

## Variable private position

### Quantity

- Quantity is a positive whole number of the market base lot.
- The market publishes a minimum and maximum quantity per order.
- The first testnet base lot remains one whole winning share.
- Fractional positions stay disabled until all contract, circuit, and UI math supports exact atomic conservation.
- The UI accepts arbitrary whole quantities within the published limit.

For quantity `q` and base lot `L`:

`winning_quantity = q * L`

The private position budget covers:

`maximum_payout + maximum_trade_fee + authorized_service_fee`

Every multiplication is range-checked before it enters the BN254 field.

### Encrypted order

Each order contains three Baby Jubjub ElGamal ciphertexts:

1. Side ciphertext for `s`, where `s` is zero or one.
2. YES quantity ciphertext for `s * q`.
3. NO quantity ciphertext for `(1 - s) * q`.

The order proof establishes:

- `s` is binary.
- `q` is within the market range.
- All three ciphertexts use the registered committee public key.
- The encrypted values match the same `s` and `q`.
- The private position budget is sufficient for `q`.
- The position note binds side, quantity, market, epoch, rules, and fee policy.

The public operation context binds a canonical hash of all ciphertext points. The contract validates each point before storing the order.

### Recoverable encryption randomness

Encryption randomness is deterministically derived inside the order proof from the position note spending secret, note identifier, operation domain, and three distinct labels. The client performs the same derivation.

This avoids storing raw encryption randomness in Supabase or relying on one browser. A clean wallet can recover the position note, derive the same randomness, and prove later actions.

## Aggregate-only batch decryption

The coordinator must not receive a combined committee secret.

The batch proof:

1. Reconstructs the complete accepted-order root in public sequence order.
2. Aggregates the three ciphertext classes without decrypting an individual order.
3. Verifies threshold partial decryptions and their discrete-log equality proofs against the committed DKG verification shares.
4. Recovers only aggregate YES count, YES quantity, and NO quantity.
5. Derives NO count as batch size minus YES count.
6. Enforces the total and per-side privacy floors.
7. Binds the aggregate values to the exact LMSR quote and state transition.

No witness contains a combined committee secret or individual plaintext order.

The DKG configuration commitment binds:

- Network and shared vault.
- Committee epoch.
- Threshold and member count.
- Member verification shares.
- Transcript hash.
- Proof system and curve identifiers.
- Activation and retirement bounds.

An order accepted under one committee epoch executes or refunds under that epoch.

## Variable-quantity batch accounting

For public aggregate YES quantity `QY` and NO quantity `QN`, the market computes exact aggregate side costs:

- `MY` for YES.
- `MN` for NO.
- `MY + MN` equals the aggregate LMSR charge.

The public atomic unit charges are:

- `uY = floor(MY / QY)`
- `uN = floor(MN / QN)`

An individual private order with quantity `q` pays:

- `q * uY` for YES.
- `q * uN` for NO.

The protocol rounding contribution is:

`MY - QY * uY + MN - QN * uN`

It is public, nonnegative, strictly less than `QY + QN`, advanced by the explicit rounding reserve, and repaid under the existing normal-resolution or VOID rules. It is not revenue.

The fee uses one public per-unit fee for each side. Any fee remainder follows the same explicit bounded reserve and reconciliation policy. The protocol cannot collect a hidden residual.

## Position recovery and settlement

The complete accepted epoch set executes together or becomes refundable.

For an executed order, the user proves:

- Ownership of the position note.
- Accepted-order membership.
- The three stored ciphertexts match the note's hidden side and quantity.
- The quantity matches the position budget constraints.
- The batch aggregate and price record is the order's own epoch record.

The user can then recover:

`change = position_budget - side_unit_charge * q - side_unit_fee * q`

At normal resolution, a winning position receives:

`winning_credit = base_lot_payout * q`

At VOID, the user recovers the amount defined by exact execution and change accounting with no vested trade fee.

An unexecuted refundable order recovers its full position budget.

Each position retains one terminal nullifier across claim, loss finalization, VOID refund, and unexecuted refund.

## Supabase and browser boundary

- Plaintext private balance is computed locally from encrypted notes.
- Plaintext side, quantity, note value, claim, refund, LP share, and action history are never written to Supabase.
- Supabase stores only the existing fixed-size authenticated encrypted archive pages and opaque capability data.
- Browser storage is not the source of truth.
- A clean device restores notes from the wallet-derived viewing key and durable output history, then optionally restores encrypted activity labels from the opaque archive.
- Social profile and comment data remain separate from the private archive.

## UI behavior

### Portfolio

- One reusable private USDC card.
- Public wallet USDC and private USDC shown separately.
- Custom deposit amount and maximum wallet amount.
- Clear disclosure that public deposits and withdrawals expose amount and wallet.
- Private withdrawal amount and recipient confirmation.
- Pending, confirmed, indexed, and recoverable deposit states.

### Bet panel

- Whole quantity input instead of a fixed one-position label.
- Local validation against market quantity bounds.
- Required private budget calculated from the exact contract policy.
- Private balance check before proof generation.
- Link to Portfolio when balance is insufficient.
- Automatic private consolidation when total balance is enough but fragmented.
- Next collecting epoch wait instead of a closed-batch error.
- Indicative price, batch countdown, public movement bound, minimum batch rule, and refund deadline.

### Liquidity

- Uses the same Portfolio private balance.
- Does not offer a separate deposit flow.
- Checks private balance before LP funding or replacement.
- Automatically consolidates when needed.

## Migration rule

Verification keys, note domains, ciphertext schema, and nullifier-count rules are immutable for one vault deployment. These changes require a fresh testnet verifier, shared vault, factory, and newly activated markets.

The current testnet deployment remains readable until its user notes and LP positions are recovered or explicitly abandoned as test assets. The app must not silently point an existing private balance at a new vault.

Before switching the public testnet configuration:

1. Publish the old and new contract manifests.
2. Provide old-vault balance, position, LP, claim, refund, and withdrawal access.
3. Mark every old market as a testnet migration market.
4. Confirm the user understands that testnet USDC has no real monetary value before any explicit reset.
5. Clear public catalog rows only after the old manifest remains available for recovery tooling.

## Testnet release gates

1. One deposit supports at least 20 sequential mixed bet, LP, consolidation, claim, refund, and withdrawal actions without another deposit.
2. A positive displayed balance is always selectable or automatically consolidatable.
3. Quantities at minimum, maximum, and every generated boundary conserve value.
4. Invalid zero, fractional, overflow, and over-limit quantities fail before note consumption.
5. Individual side and quantity do not appear in contract calls, events, service logs, Supabase rows, or public portfolio data.
6. The batch prover receives no combined committee secret.
7. The batch proof accepts valid threshold partial decryptions and rejects a bad share, bad equality proof, duplicate member, wrong transcript, wrong epoch, false aggregate, and insufficient threshold.
8. Reordering or omitting an accepted ciphertext changes the accepted root or aggregate and fails.
9. Public side costs, unit charges, fees, and rounding reconcile to the exact market charge.
10. Every user change, winning claim, loss, VOID refund, and unexecuted refund matches the hidden quantity.
11. A clean browser restores private notes and can continue spending without local storage.
12. Supabase administrators see no plaintext private balance, side, quantity, market participation, LP ownership, or financial history.
13. The old testnet manifest remains recoverable during the explicit cutover.
14. Rust, Circom, service, and browser tests pass from a clean checkout.
15. Rust verification ends with `cargo clean` and no remaining target directory.

## Mainnet prohibition

Mainnet remains blocked until the aggregate-only threshold construction, variable-quantity circuits, note consolidation, contracts, service code, recovery path, and migration procedure receive independent review and the full public testnet gate passes.
