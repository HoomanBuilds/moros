# Multi-user shielded collateral implementation plan

## Goal

Implement the privacy specification in `docs/specs/2026-07-22-shielded-collateral-privacy.md` so Moros can serve many concurrent users with reusable shielded USDC balances, relayed bets, shielded refunds, shielded claims, reliable recovery, and honest privacy guarantees.

Implement creator-free market funding, private LP shares, LP exits, execution fees, and uniform fixed-lot batch pricing through the companion plan `docs/plans/2026-07-23-permissionless-liquidity-and-private-batch-pricing.md`. That plan supersedes creator-subsidy, fee, and order-allocation work below for new LP-backed markets.

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
- Do not use the privacy factory to bypass oracle capability gating. Sports, politics, weather, and other event categories remain unavailable until their tracked resolution stack passes its own release gates.
- Run `cargo clean` after every Rust build or test session and verify no `target` directory remains before handoff.

## Delivery decision

Build the privacy layer around one shared Stellar USDC vault used by all new Moros markets.

Do not extend the current direct-wallet `place_order` flow. It fundamentally exposes the wallet and public stake bucket. Keep it operational only for already deployed markets while the new shared-vault flow is tested.

The new flow is:

1. User deposits USDC into the shared vault and receives private balance notes.
2. User creates a fixed-lot private order and locks its maximum budget.
3. A relayer submits the proof-bound order intent.
4. Offchain coordinators and the committee form a valid mixed batch, and a relayer submits it to the vault.
5. The vault acts as the market's sole batcher, funds the exact aggregate LMSR charge, and receives aggregate outcome shares.
6. After execution, each user recovers unused budget into a private change note.
7. Resolution returns aggregate winning value to the shared vault.
8. Each winner claims into a new private balance note, while every position reaches a final spent state.
9. The user may reuse that balance or withdraw publicly later.

Do not deploy a separate custody router in the first implementation. The current LMSR contract requires its configured batcher to fund each batch, receive both outcome shares, receive VOID batch-collateral refunds, and redeem aggregate winnings. The vault therefore owns the onchain routing module and is the exact batcher address. Offchain coordinators have no custody or contract authority.

Deploy a noncustodial `MarketFactory` for permissionless user-created markets. The factory records supported proposals without requiring creator USDC. After a linked isolated liquidity vault reaches its target, activation deploys only approved market WASM and atomically completes vault batcher, liquidity vault, USDC, resolver, fee, timing, rules, funded loss bound, and vault-registration checks. It never holds shared shielded balances.

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
- Add regression fixtures proving that one global stored execution price can overwrite an earlier batch, that post-batch spot price does not allocate exact LMSR cost, and that current creator-only funding has no LP share or terminal distribution path.
- Resolve the ignored local draft `docs/specs/2026-07-20-economics-and-lifecycle.md`, which currently contradicts the tracked testnet specification and contract on one-sided markets. It is not a release source until the user deliberately approves a corrected tracked copy.
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
- Record that upstream currently labels its latest release `v0.1.0`, remains work in progress and unaudited, and warns that breaking changes are expected. Recheck this fact when the spike begins.
- Record Apache, GPL, LGPL, and generated-artifact obligations for each reused component.
- Compare its curve, hash, proof serialization, key format, and SDK with Moros's current BLS12-381 pipeline.
- Benchmark its verifier against Moros's current verifier on the active Stellar protocol.
- Confirm Circle USDC SAC interaction on testnet.
- Confirm auth-entry relaying works with a distinct transaction source.
- Evaluate Association Set Provider and selective-disclosure support without allowing policy changes to trap existing notes.
- Verify that upstream output-note recovery does not depend on one browser tab or short RPC event retention.
- Do not adopt an upstream public address-to-shielded-key registry for private Moros actions because it would recreate a wallet linkage.
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

- Domain-separated balance, position, service escrow, operator compensation, payout, refund, treasury, and padding commitments.
- Nullifier derivation.
- Per-market accepted-position tree construction, sparse included-set membership and non-membership, and final root sealing.
- One-input and two-input spends.
- One-output and two-output change.
- Maximum USDC value, zero value, one atomic unit, and overflow attempts.
- Whole-share to USDC atomic conversion and rejection of unsupported fractional share quantities.
- Network, vault, asset, purpose, market, and operation-context mismatch.
- Public-signal ordering and byte conversion.
- Deterministic encrypted output-note recovery.
- Separate input-note, position-note, and action identifiers with no early publication of a position spend nullifier.
- One path-independent terminal nullifier for winning claim, losing recovery, pending refund, and VOID refund of the same position.
- Signed relayer quote replay, expiry, operation, beneficiary key, and zero-fee cases.
- Service-escrow release on successful batch and full return on deadline refund.

### Work

- Define one canonical field encoding document.
- Define USDC atomic-unit range and every multiplication bound before writing constraints.
- Keep whole-share quantities for the first shared-vault testnet. Record the exact Q32-to-USDC conversion rule and block finer precision until aggregate payout conversion is exact in every differential fixture.
- Define fixed input and output counts for each action to reduce metadata leakage.
- Bind network passphrase, vault ID, USDC SAC ID, operation type, market context, relayer policy, and expiry into an operation-context hash.
- Bind every output note to its owner viewing and spending keys.
- Fix a reviewed authenticated-encryption envelope with an ephemeral key, nonce, fixed ciphertext length, and no stable public viewing-key identifier.
- Represent platform and relayer compensation as shielded fee notes so per-action fees do not create identifying public transfers.
- Keep any future batch service budget in a separate shielded escrow note. Release it only on valid inclusion and return it on an unbatched refund.
- Define signed relayer quotes that bind vault, operation, action ID, fee-note key, exact fee or maximum fee, and quote expiry. Testnet permits zero-fee quotes.
- Consume funding-note nullifiers when an order becomes pending. Do not reveal the position-note nullifier until claim or refund.
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
- Private transfer, order, claim, and refund require no public user-address authorization entry.
- Wrong roots, old roots outside the accepted window, duplicate roots, malformed proofs, duplicate nullifiers, and duplicate output commitments fail.
- A failed nested token or market call leaves inputs unspent and outputs absent.
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
- User deposits, isolated LP funding, rounding reserves, refundable fee escrow, and explicit operations funding equal user, LP, treasury, and operator withdrawals plus vault balances and collateral still held by registered markets.
- For every batch, change, fee escrow, rounding contribution, and YES, NO, and VOID position liabilities reconcile to locked budgets and aggregate market redemption.
- VOID returns the exact aggregate market charge and preserves full position budgets before any optional relayer fee.
- Platform, relayer, service-escrow, and operator notes are included in liabilities and cannot be withdrawn from another user's backing.
- Any defensive reconciliation residual has a proved source and bound and cannot be withdrawn by treasury or governance while it may back user liabilities.
- Pausing cannot block exits.

Use the existing Rust test framework. Do not add a new test framework solely for this package.

### Contract work

- Store immutable network, USDC, treasury key, and proof configuration.
- Store commitment frontier, current root, bounded root history, and capacity.
- Store each spent nullifier under its own persistent key, never delete it, and restore it before use if archived. Reconfirm on the active protocol that an archived persistent key cannot be recreated or interpreted as absent.
- Store each market's accepted-position root, sparse included-position set root, immutable per-batch allocation roots, and sealed final roots after batching closes.
- Store data in bounded keys so one global entry does not grow with users.
- Persist commitment, leaf index, root, fixed-length encrypted output envelope, and action ID without plaintext owner or value. Events mirror recovery data but are not its only durable source.
- Support public deposit, private transfer, market-bound spend, shielded credit, and public withdrawal.
- Make relayer submission permissionless after proof verification.
- Make TTL extension permissionless and safe.
- Verify that the configured USDC SAC and network match the deployment manifest. Document issuer freeze and clawback risk without claiming the vault can bypass it.

### Performance gate

Measure contract resources for deposit, transfer, order spend, batch routing, claim credit, persistent ciphertext recovery, and withdrawal at empty, half-full, and high tree counts. Measure WASM size and storage rent. Do not choose tree depth or root-history length before these measurements.

## Work package 4: Build vault routing and market settlement

### Planned location

- `contracts/shielded-collateral-vault/src/router.rs`
- `contracts/market-factory/`
- Required settlement changes under `contracts/lmsr-market/`

### Contract tests first

- Deploy and register only exact approved market WASM, resolver, collateral, fee, treasury, close time, rules hash, and LMSR configuration through the approved factory.
- Let any user propose a qualifying market without USDC or a Moros operator transaction, then let any caller activate it after permissionless LP funding reaches the target.
- Reject direct self-reported WASM identity or registration without an authenticated factory deployment record.
- Bind proposal and deployment salt to creator, shared vault, liquidity vault, network, rules hash, and market configuration. Reject duplicates without moving LP funding.
- Revert market deployment, configuration, LP reserve transfer, and shared-vault registration together when any nested step fails.
- Keep onchain activation independent from offchain metadata listing, and retry listing without contract redeployment or another LP reserve transfer.
- Reject registration until the isolated liquidity vault covers the rounded-up LMSR worst-case loss and the market permanently designates the shared vault as batcher.
- Reject a market that does not designate the vault as its sole batcher.
- Accept a proof-bound private position without a wallet owner and consume its funding-note nullifiers atomically.
- Reject orders at and after market close.
- Enforce one sequential collecting epoch per market, seal its exact accepted root and count at the ledger-time cutoff, and open the next epoch only after execution or refund finalization.
- Reject duplicate commitments, input nullifiers, and action IDs while keeping the position spend nullifier private until claim or refund.
- Apply a batch only once and only when the mandatory aggregate proof, verifiable aggregate decryption, and required committee threshold statement verify.
- Reject a batch whose quantities, commitments, batch allocation root, market, epoch, backing statement, or signer set differs from the attested statement.
- Reject a batch unless every included commitment belongs to the accepted-position tree and changes from absent to present under the sparse included-position set root.
- Process only complete epoch sets with at least eight positions and at least two positions on each side. Never weaken this floor for a final window.
- Permit one configured lot per market epoch, cap acceptance at the measured maximum, and reject later orders without consuming their notes.
- Require every eligible commitment accepted for the bounded epoch and reject coordinator-selected omissions or substitutions.
- Never settle a lone order or a one-sided aggregate. Make every affected position shielded-refund eligible after the deadline.
- Authorize only the exact vault-to-market USDC transfer returned by `quote_batch`, call `apply_batch` as the vault, and assert the returned charge.
- Use the companion fixed-lot Aumann-Shapley rule to calculate order-independent uniform YES and NO charges.
- Prove that user side charges plus the explicit bounded protocol rounding contribution equal the exact atomic LMSR charge.
- Repay every rounding contribution before the normal-resolution fee split or from the returned market charge on VOID.
- Record authoritative uniform side prices, side charges, lot, pre-state, post-state, and one immutable batch allocation root.
- Prove before acceptance that bettor entitlements, fee escrow, protocol rounding, and market redemption reconcile exactly for YES, NO, and VOID.
- Make an unbatched order shielded-refund eligible after the deadline.
- Make the finalization transaction close batching before it seals the accepted and included roots. Test the exact boundary against concurrent final-batch and pending-refund submissions.
- Pull aggregate winning value once after resolution and record the exact receipt.
- On VOID, recognize the market's atomic batch-collateral return before enabling included-position refunds.
- Create claim and refund rights that can only become proof-verified vault notes.
- Settle terminal market-maker equity to the isolated liquidity vault only after aggregate winning redemption, with no path to consume user or treasury note backing.
- Exercise one relayer, coordinator, committee member, keeper, and RPC outage independently.

### Contract work

- Keep per-market state in bounded persistent keys under the vault contract.
- Store policy capabilities, not an operator-curated list of individual markets. Approved factory, WASM hashes, resolver types, USDC, timing bounds, and fee caps are governance parameters; qualifying market creation and registration are permissionless.
- Use the companion execution-fee curve and LP split for new LP-backed markets. Preserve existing deployed-market fee behavior only for compatibility.
- Keep order commitments and statuses independent of wallet addresses.
- Store accepted fixed-length ciphertexts and acceptance sequences in durable ledger-reconstructable data so any coordinator can rebuild the complete batch.
- Call each LMSR market with aggregate values only.
- Store per-batch allocation root, informative average execution price, sparse included-set state, aggregate market receipts, and claim-finalization state.
- Expose permissionless close, final-batch, refund-enable, aggregate-redeem, and TTL functions.
- Ensure a coordinator or committee outage cannot block refunds after the defined deadline.
- Keep the offchain coordinator stateless with respect to custody. Any relayer can call the vault with the mandatory proof, verifiable aggregation and decryption evidence, and required threshold statement.

### Existing contract changes

- Use the current `contracts/lmsr-market` batcher flow with the shared vault as batcher. Change it for tested LP reserve separation, uniform batch pricing, fee escrow, and terminal market-maker equity settlement.
- Prefer atomic constructor or factory initialization for batcher, resolver, creator, liquidity vault, collateral, timing, rules, fee, batch policy, and funded loss bound so a new market cannot exist in a partially configured state.
- Do not alter already deployed instances.
- Keep `contracts/shielded-pool` operational for existing markets and add no new users to it after the shared flow is enabled.

## Work package 5: Build private balance, order, claim, refund, and withdrawal circuits

### Planned circuits

- Note commitment and nullifier primitives.
- Private balance transfer.
- Balance-to-position spend.
- Position encryption consistency.
- Mixed-batch aggregation, exact LMSR cost allocation, and two-outcome backing.
- Accepted-position membership and sparse included-set non-membership for pending refunds.
- Shielded winning claim.
- Shielded losing-value recovery.
- Full void refund.
- Never-included order refund.
- Public withdrawal with private change.
- Treasury fee note creation.
- Service-escrow release and refund.

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
- Whole-share quantity enforcement and unsupported fractional-share rejection.
- Outcome, hidden side, uniform side charge, and lot binding.
- Batch-specific allocation-root binding across two or more batches.
- Private membership in included and refundable position roots without exposing the position commitment.
- Private membership in an immutable batch root, or accepted membership plus included non-membership under sealed final roots, with unique position-nullifier replay protection.
- Nonzero aggregate YES and NO enforcement.
- Minimum batch size of eight, minimum per-side count of two, complete eligible-set inclusion, and no short-final-set bypass.
- Correct homomorphic sum and threshold decryption against the public DKG transcript.
- Exact atomic charge allocation and two-outcome entitlement equality.
- Fee-free void and principal refund.
- Signed relayer quote, fee-note beneficiary, operation, expiry, and replay binding.
- Batch operator compensation from proved service escrow and no compensation on failed inclusion.
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

The differential corpus must include several batches at different market states. For each batch, compute `S_B`, `M_B`, `R_B`, uniform `cY` and `cN`, trade-fee escrow, `W_B(YES)`, `W_B(NO)`, `E_B(YES)`, and `E_B(NO)`. Require `sum(user_side_charges) + R_B = M_B` and exact entitlement equality for YES, NO, and VOID. Reject any case where allocation depends on coordinator choice, a later spot price changes an earlier entitlement, or a residual is treated as revenue without a proved accounting source.

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
- Concurrent final-batch-versus-refundable-root sealing and duplicate claim or refund nullifier conflicts.
- Next-epoch acceptance racing prior-epoch execution or refund finalization.
- Process termination during every database transition.
- Queue restart with no lost or duplicated orders.
- Two batch workers competing for the same market window.
- Coordinator attempts to skip, reorder, substitute, or selectively include accepted commitments.
- Valid committee signatures attached to a false aggregate or invalid decryption.
- DKG rotation while accepted old-epoch orders remain pending.
- DKG transcript mismatch, duplicate member, bad verification share, identity point, wrong subgroup, failed proof of possession, and unresolved complaint.
- Committee member timeout and quorum recovery.
- RPC timeout after submission but before transaction confirmation.
- Indexer reset and restore from a durable checkpoint.
- Clean-wallet recovery after remaining offline longer than public RPC transaction and event retention.
- Two indexers using independent RPC or raw-ledger sources and detecting a deliberately corrupted checkpoint.
- Signed relayer quote expiry, replay, wrong beneficiary, wrong operation, and zero-fee behavior.
- Maliciously large bodies, invalid proof encodings, and rate-limit abuse.
- Log redaction for every public endpoint.

### Durable state

- Replace mutable JSON queue files with a transactional job store that supports unique action IDs, unique nullifiers, row locking, status history, and retries.
- Use the existing free Supabase/Postgres environment for testnet only if private archive rows contain no plaintext wallet, market, pool, transaction hash, commitment, nullifier, action type, amount, side, payout, note secret, viewing key, or exact action time.
- Keep a storage adapter so the service can move to self-hosted Postgres without protocol changes.
- Persist encrypted intents and public proof data only as long as required for batching and recovery.
- Define cleanup and retention jobs with tests.

### Testnet operating budget

- Keep relayer, coordinator, committee, keeper, and TTL service fees at zero for the free testnet.
- Fund service accounts only with testnet XLM and publish their low-balance health state.
- Do not infer a mainnet fee from testnet usage. Measure XLM and service costs, then implement the shielded service-escrow model before any nonzero batch compensation is enabled.

### Relayer API

- `POST /intents` accepts a proof-bound opaque action.
- `GET /intents/:actionId` returns received, validating, submitted, confirmed, rejected, or expired.
- `GET /relayers` publishes supported vaults, fee policy, limits, and health.
- `GET /relayers` returns a signed operation-specific quote with quote ID, fee-note key, amount, and ledger expiry.
- Submission is idempotent.
- A user may choose another relayer without creating a different spend.
- The fee payer validates the entire invocation tree and rejects any authorization involving the fee-payer address.
- Private actions reject any unexpected public user-address authorization entry. Only public deposit authorization and the public withdrawal recipient are wallet-visible boundaries.

### Committee, coordinator, and batch submitter

- Register the shared vault, its approved markets, and the internal routing capability through exact onchain linkage and approved WASM hashes.
- Run reviewed dealerless DKG and publish the network, vault, encryption suite, threshold, member set, member verification shares, transcript hash, proof-of-possession results, activation ledger, and retirement policy.
- Block an epoch on invalid or missing shares, transcript disagreement, duplicate members, identity or wrong-subgroup points, failed possession proof, or unresolved complaints.
- Keep secret shares out of Supabase, application logs, browser state, general backups, images, and source control.
- Queue across all registered markets.
- Build windows fairly so one high-volume market cannot starve another.
- Derive each window from every eligible commitment accepted for the bounded market epoch.
- Maintain the batch floor of eight and per-side floor of two, and never process a short or one-sided final set.
- Verify homomorphic aggregation and each aggregate threshold decryption against public DKG verification shares. Committee signatures alone never authorize quantities.
- Persist DKG epoch, consumed funding-note nullifiers, action IDs, batch membership, and transaction results without storing future position spend nullifiers.
- Allow any relayer to submit a valid aggregate proof with the required threshold statement. Do not require an admin endpoint for fallback.

### Indexers

- Run two independent commitment and market indexers.
- Use independent RPC or raw-ledger sources so both indexers do not share one availability and integrity failure.
- Verify roots against the contract after every append.
- Rebuild fixed-length encrypted output envelopes from persistent contract entries by default.
- Save hash-addressed checkpoints that are reproducibly verified against onchain roots. A Moros signature alone is insufficient.
- Alert and stop serving witnesses on any root divergence.
- Support pagination and bounded-memory rebuilds for large user counts.

## Work package 7: Rebuild browser note storage and recovery

### Tests first

- Deterministic key recovery across supported Stellar wallets.
- Clean-browser recovery from persistent encrypted output records and independently verifiable checkpoints.
- Recovery after the wallet was offline longer than public RPC retention.
- Two-device note discovery and conflict resolution.
- Browser crash before submission, during submission, after chain confirmation, and before local commit.
- Wallet switch, network switch, vault switch, and locked wallet.
- Corrupted local database, corrupted cloud blob, missing cloud service, and stale indexer.
- Supabase administrator reads every private table and sees no wallet, market, pool, transaction, commitment, nullifier, action type, amount, side, payout, note purpose, or exact action time.
- Social wallet authentication and private synchronization cannot be joined by auth user, wallet, email, row key, storage path, foreign key, request tag, or shared client session.
- Replay, reused nonce, wrong bucket, wrong request signature, expired request, stale generation, modified ciphertext, duplicate page, and compare-and-swap conflict.
- Two devices update the same archive, merge by cryptographic action ID and chain finality, and preserve every record.
- Supabase deletes, rolls back, reorders, and duplicates archive pages without losing spendability or forging a chain-confirmed status.
- Fixed-size page padding prevents one database row or ciphertext length from identifying one bet type.
- Private endpoints, analytics, error reporting, and server logs contain no request body, wallet signature, derived key, decrypted archive, or stable social identity.
- Supabase request logs receive the gateway identity and opaque archive fields, not the user's browser IP, wallet cookies, or social session.
- No plaintext market, amount, side, secret, nullifier, or transaction link in cloud rows.
- Fresh testnet cutover removes the legacy `private_positions` table and code path without importing its rows into the opaque archive.

### Work

- Replace wallet-keyed position records with an encrypted note database keyed by opaque note identifiers.
- Add an encrypted intent journal written before submission.
- Derive separate spending, viewing, archive-encryption, bucket, request-signing, and export keys with a reviewed KDF from domain-separated wallet signatures.
- Label the wallet signature as local unlock and recovery. Do not treat it as authorization for private vault actions.
- Never send the recovery signature or derived private keys to Moros or Supabase.
- Authenticate private backup synchronization with an opaque signed capability bound to method, bucket, generation, body hash, one-time nonce, and expiry, not the social wallet session.
- Consume request nonces once and expire their bounded replay records without using expiry as the authorization check.
- Scan encrypted output payloads and verify every discovered commitment locally.
- Reconcile nullifiers and outputs against the chain before selecting notes.
- Keep encrypted export and import as an independent recovery path.
- Change Supabase backup to fixed-size padded AEAD pages, random opaque bucket and page identifiers, an encrypted manifest, and compare-and-swap generations.
- Pack multiple activity records and dummy slots per page so row count does not directly equal bet count.
- Remove plaintext wallet, market, pool, transaction, commitment, nullifier, purpose, status, amount, side, payout, exact action time, and LP metadata from private backup storage without exceptions.
- Route private sync through a fixed-shape gateway that verifies opaque request signatures, strips browser cookies and identity headers, and uses a dedicated server-only Supabase client.
- Do not let the browser access private archive tables with `supabase-js`, and do not reuse the wallet-linked social auth user or JWT.
- Keep only cipher-suite version, schema version, opaque identifiers, generation, ciphertext, nonce, hash, and minimal provider-required retention timestamps outside encryption.
- Validate decrypted records against their authenticated schema and reconcile every financial status with onchain roots, nullifiers, receipts, and market state.
- Treat Supabase as a replaceable cache. A clean device must also recover notes from the wallet-derived viewing key and durable ledger output envelopes.
- Disable legacy `private_positions` writes, remove its browser code and live table, and start the opaque archive under the fresh shared-vault deployment without importing old rows.
- Keep old testnet contracts claimable and provide an export notice before cutover. Old local or exported records remain the user's recovery path for those positions.
- Document that historical provider backups and logs may retain old plaintext metadata until their configured retention expires.
- Keep social comments, profiles, watchlists, and market metadata completely separate.
- Disable third-party analytics, session replay, and unredacted crash reporting on private portfolio, proof, sync, and recovery routes.
- Verify published hashes for circuit WASM, proving keys, verification keys, and proof workers against an immutable vault commitment or independently signed deployment record before exposing secrets to them.

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
- Show the signed relayer quote, expiry, and fee before proving or note locking.
- Never show success before the nullifier and outputs are confirmed.
- Handle insufficient shielded balance without falling back to a direct public stake.
- Explain that one-sided pending demand may remain unbatched and will become fully refundable after the deadline.

#### Claim or refund

- Default to receiving a new shielded USDC balance note.
- Show the expected private balance change locally.
- Keep winning profit, fee, refund, and payout note values out of public calls.
- Use the immutable uniform side charge from the position's own batch allocation root and hidden side, not the latest displayed odds.
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
- Restore the encrypted Supabase archive after the local recovery signature, then reconcile it with durable chain data before showing financial status.
- Include created markets, shielded deposits and withdrawals, bettor positions, change, claims, losses, refunds, LP funding, exits, fees, and terminal LP redemption.
- Mark market creation as public onchain even when its personal history entry is encrypted in the archive.
- Support client-side filtering and pagination across multiple markets, multiple pending actions, and restored devices without sending plaintext filters to Supabase.
- Show `Local`, `Encrypted sync pending`, `Encrypted sync current`, `Chain reconciled`, and `Recovery degraded` separately.
- Provide encrypted export and recovery status from the portfolio page.

### UI tests

- Desktop, mobile, keyboard, screen reader labels, reduced motion, and slow proving.
- Multiple simultaneous actions without a global loading lock.
- Duplicate clicks and navigation during proving.
- Wallet disconnect after intent creation.
- Relayer failover.
- Empty, loading, partial recovery, degraded indexer, and service outage states.
- Cleared browser storage followed by full opaque Supabase and chain recovery.
- Supabase unavailable while the user continues through the durable ledger recovery path.
- Social account signed in while private archive remains unlinkable to that social session.
- Privacy copy exactly matches the specification.

## Work package 9: Cross-market batching and market-choice privacy research gate

### Reason for a separate gate

The shared vault hides the wallet-to-market link from the public ledger, but the first flow exposes the target market of a relayed intent, the relayer receives that target, and the chain sees the markets touched by each batch.

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

## Work package 10: Fresh testnet cutover and deployment

### Old testnet isolation

- Existing market and shielded-pool contracts remain readable and claimable.
- Existing positions are never converted automatically.
- Existing users finish claims or refunds through the current path.
- New shared-vault markets are selected by an explicit capability field, not a public release number.
- User-created qualifying markets enter permissionless funding through the approved factory and activate after atomic LP reserve and linkage checks. Unsupported resolver categories remain unavailable before funding or deployment.
- Market creation cannot select shared shielded collateral until factory, vault, market, committee, coordinators, relayers, indexers, keeper, frontend, and registry all report the same approved deployment identifiers and WASM hashes.

### Deployment order

1. Upload reviewed factory, market-liquidity-vault, shared-vault, and market WASM.
2. Deploy the factory with the approved market WASM hash and supported resolver policy.
3. Deploy the shared USDC vault with development verification keys and the approved factory address.
4. Configure multisig, timelock, immutable treasury shielded key, relayers, committee, and resolver registry.
5. Create one proposal without creator USDC, fund it from independent LPs, activate it, and verify its liquidity vault, funded loss bound, shared-vault batcher, resolver, USDC, rules, fee, batch policy, timing, deployment record, and vault registration.
6. Deploy the opaque private archive schema and signed-capability endpoint separately from wallet-linked social tables.
7. Disable legacy private backup writes, remove the live `private_positions` table and client path, and verify that the new archive starts empty under the fresh vault domain.
8. Start two indexers, two relayers, two coordinator instances, committee members, batch workers, and resolution keeper.
9. Publish frontend configuration only after service health and contract hashes match.
10. Run multi-user live testnet scenarios.
11. Enable creation of additional shared-vault markets only after the first market passes every lifecycle path.

### No partial activation

If any component reports the wrong factory, deployment record, shared vault, liquidity vault, market batcher, collateral, funded loss bound, committee, verification key, proving-artifact commitment, resolver, rules hash, fee policy, batch policy, treasury, private archive domain, network, or WASM hash, market activation and betting fail closed.

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
- Multiple users propose supported markets through the factory without creator USDC or a Moros operator transaction. A failed metadata listing retries without redeploying or moving LP funding again.
- 100 users place mixed and one-sided demand across multiple markets. Complete epoch sets of at least eight with at least two positions per side settle, while demand below either floor becomes privately refundable.
- 20 clients submit concurrently against recent accepted roots.
- No short final batch settles.
- Lone and one-sided final sets receive shielded refunds without revealing a public user address.
- Multiple batches at different market states retain separate exact batch allocation roots and informative average execution prices.
- YES, NO, VOID, stale-oracle, and delayed-resolution paths complete.
- Winners claim into shielded balances.
- Every executed user recovers exact unused budget after batching, equal to budget minus the uniform hidden-side charge, refundable trade-fee escrow, and earned service fee.
- Treasury receives exact shielded fee notes.
- Users reuse payouts in another market without a public wallet transaction.
- Users withdraw partial and full balances through different relayers.
- A clean wallet offline beyond public RPC retention restores every unspent note from persistent or independently archived ledger data.
- A clean browser with deleted local storage restores encrypted created-market, bettor, LP, claim, refund, and withdrawal history from opaque Supabase pages, then reconciles every status with chain data.
- A Supabase administrator export contains only opaque identifiers, padded ciphertext, cipher metadata, generations, hashes, and minimal provider timestamps.
- Supabase rollback, deletion, outage, and cross-device write conflict do not lose funds or forge history.
- Terminal market-maker equity reaches the correct LP vault only after aggregate winning redemption and does not change bettor liability coverage.
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
- Exact per-batch charge allocation, backing for both possible outcomes, and any defensive reconciliation reserve.
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
5. `feat: add private market factory and routing`
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
2. Create and atomically register a supported market through the approved factory without a Moros operator transaction.
3. Deposit USDC once into the shared vault.
4. Disconnect the wallet from transaction submission. A later deterministic wallet signature may unlock and recover local shielded keys but does not authorize a private action transaction.
5. Place multiple bets across markets through relayers using shielded balance.
6. Recover the same notes in a clean browser.
7. Receive a winning claim or refund as shielded USDC.
8. Reuse that USDC in another market without a public wallet transfer.
9. Withdraw later to a chosen public address.
10. See accurate history and recovery state.
11. Complete every action when one relayer or one committee member is unavailable.
12. Recover one-sided pending demand as a full shielded refund after the deadline.
13. Restore all unspent notes after remaining offline longer than public RPC retention.

The ledger must show the original deposit and final withdrawal, but it must not contain a protocol-level link from the user's wallet to an individual bet, shielded claim, or private balance.
