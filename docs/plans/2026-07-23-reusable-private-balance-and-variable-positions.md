# Reusable private balance and variable position implementation plan

## Goal

Implement `docs/specs/2026-07-23-reusable-private-balance-and-variable-positions.md` on `feat/platform-hardening` without weakening the existing LP, solvency, refund, or privacy rules.

Keep `main` unchanged until the user verifies the deployed testnet flow.

## Work package 1: Lock corrected fixtures

- Add fixtures for one-input order, LP funding, and withdrawal.
- Add two-input private consolidation fixtures.
- Add sequential actions proving that one deposit remains usable.
- Add variable quantity budget, charge, fee, payout, and refund fixtures.
- Add three-ciphertext encryption fixtures.
- Add aggregate threshold-decryption fixtures with no combined secret.
- Add negative fixtures for malformed points, wrong quantities, false aggregates, and bad shares.

Gate: Rust, Circom, TypeScript, and service code agree on every field and atomic amount.

## Work package 2: Correct note liquidity

- Keep deposit output as one positive note plus one padding note.
- Change order, LP funding, and withdrawal circuits to one liquid input.
- Change vault expected nullifier counts for those actions.
- Add private self-transfer consolidation to the browser client.
- Select the smallest sufficient single note.
- Consolidate only when total private balance is sufficient but fragmented.
- Refresh chain roots and nullifiers after each consolidation.
- Test 20 sequential actions from one deposit.

Gate: no positive balance can become unusable because of note shape.

## Work package 3: Add private variable quantity

- Add quantity bounds to market policy and registration.
- Replace the one-side ciphertext with canonical side, YES quantity, and NO quantity ciphertexts.
- Bind a canonical ciphertext hash in the operation context.
- Extend accepted-order leaves and durable records.
- Prove side, quantity, budget, and ciphertext consistency in the order circuit.
- Derive ciphertext randomness recoverably from the position note secret and domain.
- Keep individual side and quantity out of public fields and logs.

Gate: minimum, maximum, random valid, zero, fractional, and overflow quantity tests pass.

## Work package 4: Remove the combined committee secret

- Bind DKG member verification shares and threshold into the committee configuration hash.
- Request partial decryptions only for the three aggregate ciphertexts.
- Require a discrete-log equality proof for every partial.
- Verify shares, proofs, unique members, transcript, threshold, and epoch in the batch proof.
- Remove `committeeSecret` from coordinator configuration, witness, environment, and state.
- Ensure the coordinator learns only aggregate counts and quantities.
- Reject committee signatures without valid aggregate-decryption evidence.

Gate: searching runtime code and deployed environment finds no combined committee secret.

## Work package 5: Update batch and settlement accounting

- Quote the LMSR from aggregate YES and NO quantities.
- Calculate public per-unit side charges.
- Bound and account for the variable-quantity rounding contribution.
- Calculate per-unit fees and reconcile any remainder explicitly.
- Remove per-position allocation witness dependency.
- Prove accepted membership and ciphertext consistency during user change, claim, and refund actions.
- Scale change, payout, fee, and VOID recovery by the hidden quantity.

Gate: exact YES, NO, and VOID conservation holds across generated multi-batch sequences.

## Work package 6: Wire services and recovery

- Update coordinator, private server, indexer, keeper, deployment manifest, and health checks.
- Keep encrypted order records durably reconstructable.
- Keep portfolio data inside opaque encrypted archive pages.
- Recover quantity and encryption randomness from note secrets and durable records.
- Add log-redaction assertions.
- Keep all service fees zero on testnet.

Gate: service restart, clean-browser recovery, duplicate relay, stale root, and committee-member outage tests pass.

## Work package 7: Complete the UI

- Keep the reusable private USDC wallet in Portfolio.
- Add custom whole-position quantity to the bet panel.
- Display exact private budget required before proving.
- Check balance locally and route insufficient users to Portfolio.
- Show consolidation progress without exposing values to the relayer.
- Use the same balance for LP funding and exit replacement.
- Show batch waiting, proving, relaying, pending, executed, refundable, claimed, and recovered states.
- Add desktop, mobile, slow proof, and failed service tests.

Gate: a user can deposit once, place several different-size bets, fund LP, recover value, and continue without another public deposit.

## Work package 8: Deploy and cut over safely

- Build and hash every circuit artifact.
- Deploy a fresh immutable verifier, shared vault, factory, resolver linkage, and new markets.
- Publish the complete contract and artifact manifest.
- Keep old testnet recovery access available.
- Wire frontend, private server, coordinator, committee members, indexer, keeper, and registry to the same manifest.
- Verify every live identifier and WASM hash.
- Run the full multi-user testnet matrix.
- Run `cargo clean` and verify no target directory remains.

Gate: the user verifies the live testnet flow before merge to `main`.

## Logical commits

1. `docs: specify reusable private variable positions`
2. `test: add reusable private note fixtures`
3. `feat: add one-input private balance actions`
4. `feat: add private balance consolidation`
5. `feat: add encrypted variable position quantities`
6. `feat: verify aggregate threshold decryption`
7. `feat: add variable quantity batch settlement`
8. `feat: wire reusable private balance services`
9. `feat: add variable private position controls`
10. `test: verify reusable private lifecycle`

Split a commit further when one layer has independent tests. Do not combine unrelated layers.
