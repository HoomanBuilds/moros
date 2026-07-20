# Moros testnet release plan

## 1. Freeze the release contract

- Record the supported price-only, free-oracle, Stellar USDC scope
- Define lifecycle, one-sided void, fee, claim, refund, and recovery acceptance cases
- Remove active prelaunch product and protocol version branching

## 2. Make contracts and circuits canonical

- Replace active numbered contract and circuit interfaces with canonical names
- Void markets that reach resolution with exposure on only one outcome
- Preserve full refunds for pending and included positions in voided markets
- Add contract and proof-economics tests for winners, losers, fees, one-sided markets, replay, and terminal states
- Build fresh WASM and proving artifacts for the testnet deployment

## 3. Enforce the supported market capability

- Enable only free-oracle price assets that pass live Stellar testnet verification
- Disable event market deployment and registration until the event operations backend is complete
- Reject non-USDC or unknown registry entries from the active release UI
- Remove unsafe seed-pool and legacy-collateral fallbacks
- Keep paid oracle adapters behind an inactive configuration switch

## 4. Build durable wallet history

- Expand the local position record with placement time, pool, collateral, submission state, and settlement transactions
- Add encrypted wallet-owned Supabase backup and restore
- Add validated local export and import
- Add retry for an order placed on-chain but not submitted to the committee
- Derive the displayed state from live market and pool data

## 5. Complete the claim and refund experience

- Calculate expected winner payout, loser remainder, full refund, and platform fee
- Show market title, side, position size, locked USDC, date, outcome, transaction, and result
- Add all, active, action required, and settled filters
- Use Claim winnings only for winners
- Use Recover remaining USDC for losing positions with recoverable collateral
- Use Claim full refund for voided or unbatched refundable positions
- Keep completed history visible and link settlement transactions

## 6. Harden testnet operations

- Install the free price resolver keeper as a managed service
- Add health output for keeper activity, committee configuration, registered pools, and stale work
- Validate pool registration against the canonical on-chain interface
- Make service restarts preserve pending work
- Add alerts or clear failed health status for unavailable committee members and overdue resolution

## 7. Build the release UI states

- Explain unsupported categories before users enter a form
- Show closed, batching, resolving, resolved, voided, claimable, recovery-required, and settled states consistently
- Ensure wallet, USDC trustline, faucet, loading, rejection, retry, empty, and mobile states work
- Remove prelaunch version labels from all user-facing copy

## 8. Verify and deploy testnet

- Run every web, service, circuit, and contract test
- Run lint, type checking, production build, and browser tests
- Deploy fresh canonical contracts and at least two USDC price markets
- Update the public registry and committee to only the fresh release pools
- Run live YES and NO positions through batch, expiry, resolution, winner claim, loser recovery, void, and one-sided refund
- Verify history restoration in a clean browser profile
- Save non-secret release evidence under docs

## 9. User verification

- Keep all work on `feat/platform-hardening`
- Provide the testnet URL and exact verification checklist
- Wait for user approval before merging to `main`
