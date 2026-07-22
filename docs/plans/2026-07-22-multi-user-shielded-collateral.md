# Multi-user shielded collateral implementation plan

## Goal

Implement the privacy specification in `docs/specs/2026-07-22-shielded-collateral-privacy.md` so Moros can serve many concurrent users with reusable shielded USDC balances, relayed bets, shielded refunds, shielded claims, reliable recovery, and honest privacy guarantees.

This plan covers design validation and testnet implementation. It does not authorize mainnet deployment.

## Working rules

- Use only `feat/platform-hardening`. Do not create another feature branch.
- Keep `main` unchanged until the user verifies the complete testnet flow.
- Write failing tests before each implementation unit.
- Commit logical parts with one-line conventional commit messages.
- Do not use user-facing artificial release numbering.
- Preserve all current deployed contracts and existing user claim and refund paths.
- Do not expose note secrets, witnesses, wallet keys, service tokens, or committee shares in logs or commits.
- Prefer existing libraries and upstream Stellar privacy work over new cryptography.
- Pin every adopted upstream release and commit. Isolate it behind Moros-owned adapters.
- Do not require a paid service for the testnet privacy flow.
- Run `cargo clean` after every Rust build or test session and verify no `target` directory remains before handoff.

## Delivery decision

Build the privacy layer around one shared Stellar USDC vault used by all new Moros markets.

Do not extend the current direct-wallet `place_order` flow. It fundamentally exposes the wallet and public stake bucket. Keep it operational only for already deployed markets while the new shared-vault flow is tested.

The new flow is:

1. User deposits USDC into the shared vault and receives private balance notes.
2. User creates a private order and change note locally.
3. A relayer submits the proof-bound order intent.
4. The router and committee batch many users' orders and update each LMSR market with aggregate quantities.
5. Resolution returns aggregate winning value to the shared vault.
6. Each user claims into a new private balance note.
7. The user may reuse that balance or withdraw publicly later.

## Work package 0: Freeze the baseline and add privacy regression tests

### Purpose

Capture what the public ledger, Moros services, browser storage, and Supabase currently reveal before changing architecture.

### Tests first

Add a privacy trace test that executes the current flow and records:

- Transaction source account.
- USDC transfer sender, receiver, and amount.
- Market and pool contract calls.
- Order commitment and status.
- Relayer recipient and payout.
- Committee request fields.
- Supabase backup columns.

The baseline test must prove that the current wallet-to-pool stake transfer is observable. It becomes the regression fixture used to show the new flow removed that link.

### Work

- Add a machine-readable privacy inventory under `docs/specs/`.
- Add a fixture decoder for Soroban transaction envelopes, auth entries, contract events, and SAC transfer events.
- Add a log scan that fails if test output contains known note secrets, nullifiers, exact private amounts, or committee shares.
- Add an assertion that the current cloud backup exposes market and transaction metadata even though its payload is encrypted.
- Record current proof generation time, verification resources, transaction size, queue throughput, and event volume.

### Gate

No implementation begins until the baseline report is reproducible from a clean checkout.

## Work package 1: Evaluate and pin Stellar Private Payments primitives

### Purpose

Reuse the strongest available Stellar-native implementation without importing unstable code directly into production paths.

### Tests first

Create an isolated spike that must pass:

- Two different users deposit testnet USDC into one shared pool.
- Each user privately transfers value into new notes.
- One user withdraws through a separate fee payer.
- Input and output values conserve exactly.
- Reused nullifiers fail.
- Wrong network, asset, contract, root, recipient, and expiry fail.
- A clean browser derives the same shielded keys and restores notes.
- Proving works in Chromium on desktop and a throttled low-end profile.

### Review checklist

- Pin the latest reviewed Stellar Private Payments tag and exact commit.
- Record Apache, GPL, LGPL, and generated-artifact obligations for each reused component.
- Compare its curve, hash, proof serialization, key format, and SDK with Moros's current BLS12-381 pipeline.
- Benchmark its verifier against Moros's current verifier on the active Stellar protocol.
- Confirm Circle USDC SAC interaction on testnet.
- Confirm auth-entry relaying works with a distinct transaction source.
- Evaluate Association Set Provider and selective-disclosure support without allowing policy changes to trap existing notes.
- Verify that upstream output-note recovery does not depend on one browser tab or short RPC event retention.
- Review all open upstream security warnings relevant to the selected commit.

### Decision record

Write one compatibility decision under `docs/specs/` with one of these outcomes:

- Adopt pinned contracts, circuits, and SDK through adapters.
- Adopt only the note and circuit model while keeping Moros contracts.
- Reject the dependency with measured reasons and implement the same reviewed model locally.

No cryptographic implementation proceeds without this decision.

## Work package 2: Lock the note, proof, and public-signal formats

### Purpose

Prevent contract, circuit, service, and browser implementations from drifting.

### Tests first

Create cross-language fixtures that are consumed by Circom, Rust, and TypeScript. The fixtures cover:

- Domain-separated balance, position, payout, refund, treasury, and padding commitments.
- Nullifier derivation.
- One-input and two-input spends.
- One-output and two-output change.
- Maximum USDC value, zero value, one atomic unit, and overflow attempts.
- Network, vault, asset, purpose, market, and operation-context mismatch.
- Public-signal ordering and byte conversion.
- Deterministic encrypted output-note recovery.

### Work

- Define one canonical field encoding document.
- Define USDC atomic-unit range and every multiplication bound before writing constraints.
- Define fixed input and output counts for each action to reduce metadata leakage.
- Bind network passphrase, vault ID, USDC SAC ID, operation type, market context, relayer policy, and expiry into an operation-context hash.
- Bind every output note to its owner viewing and spending keys.
- Represent platform and relayer compensation as shielded fee notes so per-action fees do not create identifying public transfers.
- Define root-history acceptance and maximum proof age in ledgers.
- Define padding-note rules and ensure zero-value notes cannot create spendable value.
- Create a circuit manifest containing source hashes, R1CS hash, proving key hash, verification key hash, public-signal schema hash, and build command.

### Gate

All three implementations produce identical commitments, nullifiers, context hashes, and public signals from the same fixtures.

## Work package 3: Build the shared ShieldedCollateralVault

### Planned location

- `contracts/shielded-collateral-vault/`
- `contracts/shielded-collateral-vault/circuits/`

### Contract tests first

Add Soroban tests for every state and action pair:

- Constructor accepts only the configured Stellar USDC SAC and valid immutable verification keys.
- Deposit transfers exactly the public amount and appends exactly the proven outputs.
- Private transfer consumes each nullifier once and appends proof-bound outputs.
- Withdrawal binds recipient, amount, change, fee, relayer policy, network, vault, and expiry.
- Wrong roots, old roots outside the accepted window, duplicate roots, malformed proofs, duplicate nullifiers, and duplicate output commitments fail.
- A failed nested token or router call leaves inputs unspent and outputs absent.
- Deposits and new orders can pause while private transfer, claim, refund, and withdrawal exits remain available.
- Treasury actions cannot touch user notes.
- Persistent state restoration and TTL behavior cannot make a spent nullifier reusable.
- Maximum tree capacity fails safely before accepting funds.

### Stateful invariant tests

Generate long mixed action sequences across many users and assert:

- Public assets cover public aggregate liabilities.
- Every accepted output is backed by accepted inputs or a public deposit.
- Every spent note remains spent.
- Asset, network, and vault domains never mix.
- Total deposits plus market receipts equal withdrawals plus vault balance.
- Pausing cannot block exits.

Use the existing Rust test framework. Do not add a new test framework solely for this package.

### Contract work

- Store immutable network, USDC, treasury key, router, and proof configuration.
- Store commitment frontier, current root, bounded root history, and capacity.
- Use a nullifier accumulator or another TTL-safe representation. Do not rely on expiring temporary entries for double-spend safety.
- Store data in bounded keys so one global entry does not grow with users.
- Emit commitment, leaf index, root, encrypted output payload, and action ID without plaintext owner or value.
- Support public deposit, private transfer, router-bound spend, shielded credit, and public withdrawal.
- Make relayer submission permissionless after proof verification.
- Make TTL extension permissionless and safe.

### Performance gate

Measure contract resources for deposit, transfer, order spend, claim credit, and withdrawal at empty, half-full, and high tree counts. Do not choose tree depth or root-history length before these measurements.

## Work package 4: Build the PrivateOrderRouter

### Planned location

- `contracts/private-order-router/`

### Contract tests first

- Register only exact approved market WASM, resolver, collateral, fee, treasury, close time, and LMSR configuration.
- Reject a market that does not designate the router as batcher.
- Accept a proof-bound private position from the vault without a wallet owner.
- Reject orders at and after market close.
- Reject duplicate commitments and nullifiers.
- Apply a batch only once and only with the required committee threshold or aggregate proof.
- Reject a batch whose quantities, commitments, nullifiers, market, epoch, or signer set differ from the attested statement.
- Process a full batch while open and a minimum safe short batch after close.
- Never decrypt or settle a single final order.
- Make an unbatched order shielded-refund eligible after the deadline.
- Pull aggregate winning value once after resolution.
- Create claim and refund rights that can only become proof-verified vault notes.
- Preserve the existing LMSR solvency formula for one-sided and mixed batches.

### Contract work

- Keep per-market state in persistent keys under one router contract.
- Keep order commitments and statuses independent of wallet addresses.
- Call the vault atomically for note spending and output creation.
- Call each LMSR market with aggregate values only.
- Store clearing price, batch roots, inclusion state, aggregate market receipts, and claim-finalization state.
- Expose permissionless close, final-batch, refund-enable, aggregate-redeem, and TTL functions.
- Ensure a router or committee outage cannot block refunds after the defined deadline.

### Existing contract changes

- Extend `contracts/lmsr-market` only where needed to accept the shared router as its batcher.
- Do not alter already deployed instances.
- Keep `contracts/shielded-pool` operational for existing markets and add no new users to it after the shared flow is enabled.

## Work package 5: Build private balance, order, claim, refund, and withdrawal circuits

### Planned circuits

- Note commitment and nullifier primitives.
- Private balance transfer.
- Balance-to-position spend.
- Position encryption consistency.
- Shielded winning claim.
- Shielded losing-value recovery.
- Full void refund.
- Never-included order refund.
- Public withdrawal with private change.
- Treasury fee note creation.

Prefer one composed private-order proof that covers balance spending, change, position commitment, and ciphertext consistency. If resource measurements require split proofs, both proofs must be verified atomically and bound to the same operation context.

### Circuit tests first

For every circuit, include positive and negative witness tests for:

- Ownership.
- Merkle inclusion.
- Root freshness.
- Nullifier derivation.
- Value conservation.
- Asset and network domain separation.
- Operation-context binding.
- Side range.
- Amount, stake, payout, fee, decimal, and field bounds.
- Outcome and clearing-price binding.
- Fee-free void and principal refund.
- Wrong recipient or relayer substitution.
- Cross-market and cross-contract replay.
- Zero-value padding behavior.
- Maximum and boundary values.

### Differential tests

Compute every payout and fee in:

- Circom witness output.
- Soroban Rust reference math.
- TypeScript UI estimate.
- Committee service validation.

All results must match exactly at atomic-unit precision for a generated corpus of market states and order values.

### Trusted setup rule

Testnet may use clearly labeled development keys. Mainnet requires an independent ceremony or a reviewed proving system that removes that requirement. Verification keys are immutable per vault deployment.

## Work package 6: Replace single-process files with multi-user service state

### Current problems

- `services/queue.json` and `services/pools.json` are single-process files.
- The indexer depends on short RPC event retention.
- One intake server and one relayer create availability and metadata concentration.
- Requests are not represented as idempotent durable jobs.

### Service tests first

Add tests for:

- Two relayer instances receiving the same action ID.
- Duplicate, reordered, delayed, and expired intents.
- Concurrent nullifier conflicts.
- Process termination during every database transition.
- Queue restart with no lost or duplicated orders.
- Two batch workers competing for the same market window.
- Committee member timeout and quorum recovery.
- RPC timeout after submission but before transaction confirmation.
- Indexer reset and restore from a durable checkpoint.
- Maliciously large bodies, invalid proof encodings, and rate-limit abuse.
- Log redaction for every public endpoint.

### Durable state

- Replace mutable JSON queue files with a transactional job store that supports unique action IDs, unique nullifiers, row locking, status history, and retries.
- Use the existing free Supabase/Postgres environment for testnet only if the stored rows contain no plaintext wallet, amount, side, note secret, or viewing key.
- Keep a storage adapter so the service can move to self-hosted Postgres without protocol changes.
- Persist encrypted intents and public proof data only as long as required for batching and recovery.
- Define cleanup and retention jobs with tests.

### Relayer API

- `POST /intents` accepts a proof-bound opaque action.
- `GET /intents/:actionId` returns received, validating, submitted, confirmed, rejected, or expired.
- `GET /relayers` publishes supported vaults, fee policy, limits, and health.
- Submission is idempotent.
- A user may choose another relayer without creating a different spend.
- The fee payer validates the entire invocation tree and rejects any authorization involving the fee-payer address.

### Committee and batcher

- Register the shared vault and router through exact onchain linkage and approved WASM hashes.
- Queue across all registered markets.
- Build windows fairly so one high-volume market cannot starve another.
- Maintain minimum batch privacy and never process a single final order.
- Persist DKG epoch, used order nullifiers, batch membership, and transaction results.
- Add a permissionless or paid fallback batch call where possible.

### Indexers

- Run two independent commitment and market indexers.
- Verify roots against the contract after every append.
- Save signed or hash-addressed checkpoints.
- Alert and stop serving witnesses on any root divergence.
- Support pagination and bounded-memory rebuilds for large user counts.

## Work package 7: Rebuild browser note storage and recovery

### Tests first

- Deterministic key recovery across supported Stellar wallets.
- Clean-browser recovery from encrypted output events and checkpoints.
- Two-device note discovery and conflict resolution.
- Browser crash before submission, during submission, after chain confirmation, and before local commit.
- Wallet switch, network switch, vault switch, and locked wallet.
- Corrupted local database, corrupted cloud blob, missing cloud service, and stale indexer.
- No plaintext market, amount, side, secret, nullifier, or transaction link in cloud rows.

### Work

- Replace wallet-keyed position records with an encrypted note database keyed by opaque note identifiers.
- Add an encrypted intent journal written before submission.
- Derive separate spending, viewing, backup, and sync keys from domain-separated wallet signatures.
- Authenticate private backup synchronization with an opaque sync capability, not the social wallet session.
- Scan encrypted output payloads and verify every discovered commitment locally.
- Reconcile nullifiers and outputs against the chain before selecting notes.
- Keep encrypted export and import as an independent recovery path.
- Change Supabase backup to opaque encrypted blobs and monotonic sync counters.
- Remove plaintext wallet, market, pool, transaction, placed-time, and commitment metadata from private backup storage where possible.
- Keep social comments, profiles, watchlists, and market metadata completely separate.

## Work package 8: Build the shielded balance and betting UX

### User flows

#### Shield USDC

- Show public wallet USDC separately from shielded USDC.
- Explain that the deposit transaction and amount are public.
- Offer standard deposit denominations plus a custom amount.
- Generate and persist output notes before requesting the wallet signature.
- Show pending, confirmed, indexed, and recoverable states.

#### Place a bet

- Use shielded balance without opening the wallet transaction modal.
- Select and lock notes locally.
- Generate order, encryption, balance-conservation, and change proofs locally.
- Show proving progress, relayer selection, queue status, batch status, and recoverability.
- Never show success before the nullifier and outputs are confirmed.
- Handle insufficient shielded balance without falling back to a direct public stake.

#### Claim or refund

- Default to receiving a new shielded USDC balance note.
- Show the expected private balance change locally.
- Keep winning profit, fee, refund, and payout note values out of public calls.
- Allow losing positions with recoverable value and voided positions to create shielded balance notes.
- Clearly show terminal claimed, recovered, refunded, or lost states.

#### Withdraw

- Explain that recipient, amount, and time become public.
- Let the user choose amount, recipient, relayer, and private change.
- Warn about immediate amount and timing correlation without blocking the action.
- Confirm the public transfer and remaining shielded balance.

#### History

- Build history from the user's decrypted notes and chain-confirmed nullifiers.
- Do not derive private history from public wallet transactions.
- Support pagination, multiple markets, multiple pending actions, and restored devices.
- Provide encrypted export and recovery status from the portfolio page.

### UI tests

- Desktop, mobile, keyboard, screen reader labels, reduced motion, and slow proving.
- Multiple simultaneous actions without a global loading lock.
- Duplicate clicks and navigation during proving.
- Wallet disconnect after intent creation.
- Relayer failover.
- Empty, loading, partial recovery, degraded indexer, and service outage states.
- Privacy copy exactly matches the specification.

## Work package 9: Cross-market batching and market-choice privacy research gate

### Reason for a separate gate

The shared vault hides the wallet-to-market link from the public ledger, but the relayer still receives a target market and the chain sees the set of markets touched by a batch.

Hiding each selected market requires a bounded cross-market construction. It must not be promised until measured.

### Research options

1. Encrypt a one-hot vector over a bounded active-market epoch, prove one valid market and side, aggregate ciphertexts, and decrypt only totals per market.
2. Encrypt a market slot and use threshold processing that reveals individual slots only to a quorum, while the chain receives aggregates.
3. Use a reviewed private execution design supported by Stellar when available.

### Required measurements

- Circuit constraints and browser proving time for 8, 16, and 32 active market slots.
- Ciphertext and transaction size.
- Committee aggregation and decryption time.
- Soroban verification resources.
- Market registration and epoch rotation behavior.
- Privacy effect when only one market or one user is active.

### Gate

Do not enable a UI statement that market choice is hidden from the relayer until one option passes security review and multi-user load testing.

## Work package 10: Migration and testnet deployment

### Compatibility

- Existing market and shielded-pool contracts remain readable and claimable.
- Existing positions are never converted automatically.
- Existing users finish claims or refunds through the current path.
- New shared-vault markets are selected by an explicit capability field, not a public release number.
- Market creation cannot select shared shielded collateral until vault, router, committee, relayers, indexers, keeper, frontend, and registry all report the same approved deployment identifiers and WASM hashes.

### Deployment order

1. Upload reviewed vault and router WASM.
2. Deploy the shared USDC vault with development verification keys.
3. Deploy and bind the private order router.
4. Configure multisig, timelock, treasury shielded key, relayers, committee, and resolver registry.
5. Deploy one test market and verify exact cross-contract links.
6. Start two indexers, two relayers, committee members, batch workers, and resolution keeper.
7. Publish frontend configuration only after service health and contract hashes match.
8. Run multi-user live testnet scenarios.
9. Enable creation of additional shared-vault markets only after the first market passes every lifecycle path.

### No partial activation

If any component reports the wrong vault, router, collateral, committee, verification key, resolver, treasury, network, or WASM hash, market creation and betting fail closed.

## Work package 11: Full verification

### Automated suites

- Soroban unit and stateful invariant tests.
- Circuit compile, witness, proof, verification, and negative tests.
- Rust, TypeScript, and Circom differential fixtures.
- Committee cryptography and persistence tests.
- Service API, database, concurrency, restart, and abuse tests.
- Web unit, type, lint, production build, and Playwright tests.
- Dependency and secret scans.
- Public-ledger privacy trace comparison against the baseline.

### Live testnet matrix

Use independently generated test accounts, not one wallet repeated:

- 100 users deposit and restore shielded balances.
- 100 users place mixed and one-sided bets across multiple markets.
- 20 clients submit concurrently against recent accepted roots.
- Full and short final batches settle.
- Lone final orders receive shielded refunds.
- YES, NO, VOID, stale-oracle, and delayed-resolution paths complete.
- Winners claim into shielded balances.
- Losers recover any defined residual value.
- Treasury receives exact shielded fee notes.
- Users reuse payouts in another market without a public wallet transaction.
- Users withdraw partial and full balances through different relayers.
- Duplicate nullifier, replay, wrong network, wrong market, stale root, and tampered recipient attacks fail.
- A relayer, committee member, keeper, indexer, and RPC endpoint each fail during active use.

### Load and safety report

Record:

- Browser proving p50, p95, and maximum time.
- Relayer validation and queue latency.
- Batch formation and confirmation latency.
- Contract CPU, memory, read, write, transaction-size, and fee resources.
- Indexer lag and rebuild duration.
- Root-history miss rate.
- Queue depth, retries, failures, and duplicates.
- Vault asset and aggregate liability reconciliation.
- Effective anonymity set by action window.

No performance or privacy number is published before it is measured.

## Work package 12: Security and mainnet gate

- Complete internal threat-model review before external audit.
- Freeze circuit sources, public signals, contract interfaces, and deployment hashes for audit scope.
- Run an independent circuit audit and Soroban contract audit.
- Review relayer validation, fee-payer isolation, indexer recovery, frontend proving, and encrypted backup.
- Run a trusted setup ceremony when required and publish reproducible verification artifacts.
- Fix and retest all critical and high findings.
- Run a public testnet period with a documented incident and disclosure process.
- Require independently operated committee members and relayers.
- Complete legal review for privacy and market jurisdictions.
- Only then prepare a separate mainnet deployment plan.

## Suggested logical commits during implementation

1. `test: capture collateral privacy baseline`
2. `docs: record Stellar privacy compatibility decision`
3. `test: add shielded note conformance fixtures`
4. `feat: add shared shielded collateral vault`
5. `feat: add private order router`
6. `feat: add shielded collateral circuits`
7. `feat: add durable private intent services`
8. `feat: add shielded note recovery`
9. `feat: add shielded balance user flows`
10. `test: add multi-user privacy lifecycle coverage`
11. `docs: publish honest shielded collateral operations guide`

Exact commits may be split further when a change has an independently testable boundary. Do not combine contract, service, and UI changes into one large commit.

## Final acceptance

This work is complete only when a clean testnet user can:

1. Connect a Stellar wallet.
2. Deposit USDC once into the shared vault.
3. Disconnect the wallet from transaction submission.
4. Place multiple bets across markets through relayers using shielded balance.
5. Recover the same notes in a clean browser.
6. Receive a winning claim or refund as shielded USDC.
7. Reuse that USDC in another market without a public wallet transfer.
8. Withdraw later to a chosen public address.
9. See accurate history and recovery state.
10. Complete every action when one relayer or one committee member is unavailable.

The ledger must show the original deposit and final withdrawal, but it must not contain a protocol-level link from the user's wallet to an individual bet, shielded claim, or private balance.
