# Multi-user shielded collateral privacy specification

## Status

Design for testnet implementation. This document does not claim that the current deployment provides shielded balances or unlinkable wallet activity.

## Objective

Moros will let many users deposit Stellar USDC into one shared shielded collateral vault, reuse private balances across markets, place bets without signing from their public wallet, receive refunds and payouts back into shielded balances, and withdraw later through a relayer.

The design must remain solvent, recoverable, and usable when many users act concurrently. It must not depend on a single browser, operator, relayer, indexer, or keeper to preserve user funds.

## Current verified boundary

The current system hides the selected side and exact order amount, but it does not hide wallet activity or collateral:

- `place_order` requires the user's Stellar wallet and transfers a public USDC stake bucket directly into a market-specific pool.
- The pool stores the wallet as the order owner.
- The USDC transfer event exposes sender, pool, amount, and time.
- Each market has a separate order tree, reducing the anonymity set.
- Redemption sends USDC directly to a public recipient address.
- The encrypted cloud backup stores wallet, market, pool, and transaction identifiers as plaintext metadata even though the position payload is encrypted.
- The committee endpoint is selected by pool, so the service learns which market receives an order.

These are architectural leaks. UI copy cannot fix them.

## Feasibility decision

The requested privacy is technically possible on Stellar using a shared UTXO-style privacy pool, zero-knowledge balance-conservation proofs, nullifiers, relayed transactions, and client-side note management.

Stellar's official privacy material describes shared privacy pools that obscure deposit-to-withdraw links. Nethermind's Stellar Private Payments reference implementation supports private deposit, transfer, and withdrawal notes with input ownership, nullifier, Merkle inclusion, output commitment, and balance-conservation proofs.

The reference implementation is explicitly work in progress and unaudited. Moros may reuse pinned primitives and SDK patterns after compatibility, license, performance, and security review. It must not deploy the upstream code unchanged to mainnet.

Primary references:

- https://stellar.org/privacy
- https://stellar.org/blog/ecosystem/prototyping-privacy-pools-on-stellar
- https://github.com/NethermindEth/stellar-private-payments
- https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations
- https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/persisting-data

## Honest privacy contract

### Hidden from a public ledger observer after shielding

- The wallet that placed a particular bet.
- The wallet's current shielded USDC balance.
- The exact order amount.
- The selected side.
- The link between a shielded balance note and its change note.
- The link between a position and a later shielded payout note.
- Individual fee amount when the fee remains a shielded treasury note.
- The link between a refund and the original wallet.

### Public by design

- The wallet, amount, and time of a deposit from public USDC into the vault.
- The recipient, amount, and time of a final withdrawal to a public Stellar wallet.
- The shared vault contract, supported asset, commitment roots, output commitments, and spent nullifiers.
- The markets updated by each aggregate batch.
- Aggregate YES and NO changes applied to each market.
- Market odds, close time, outcome, resolver evidence, and aggregate solvency data.
- The relayer account that submits an action.

### Privacy that depends on usage

- Deposit-to-bet unlinkability depends on other deposits, time separation, fixed action shapes, and relayer batching.
- A user who deposits and immediately performs a unique action has a weak anonymity set.
- A user who withdraws an exact unique amount immediately after a payout can create a timing and amount correlation.
- The first testnet release hides the wallet-to-market link from the public ledger. It does not hide the selected market from the relayer service.
- Full market-choice privacy requires cross-market encrypted batching and is a separate release gate.

### Not promised

- Hiding the existence of a public USDC deposit or withdrawal.
- Privacy from a compromised browser or wallet.
- Privacy from traffic analysis by a relayer that records IP addresses.
- Privacy from a colluding threshold committee if the selected cryptographic mode lets a quorum reconstruct individual data.
- A meaningful anonymity set when only one user is active.
- Mainnet safety before an independent circuit and contract audit.

## Threat model

### Public ledger observer

The observer can inspect transaction sources, auth entries, contract calls, token events, commitments, nullifiers, roots, timestamps, and market aggregates. The protocol prevents a direct cryptographic link between a public deposit commitment and a later spent note, but it cannot remove timing and amount correlations created by a small anonymity set.

Mitigations include shared cross-market collateral, standard deposit denominations, reusable balances, fixed proof shapes, padding outputs, delayed user-controlled actions, and relayer batching.

### Malicious relayer

A relayer may censor, delay, duplicate, front-run, or modify an intent. Proofs bind every value-changing output, recipient, context, fee limit, and expiry. Duplicate submission is harmless because nullifiers and action IDs are unique. Users can retry another relayer or self-submit.

Relayer compensation should be created as a shielded fee note. Relayers withdraw accumulated fees later instead of receiving one identifying public transfer per user action.

### Malicious indexer or witness service

An indexer may omit notes, return a false path, serve a stale root, or lose history. Clients recompute every path and root locally. Two independent services and durable checkpoints provide availability. A false path cannot pass the circuit.

### Malicious committee member

One member may refuse, return a bad partial decryption, sign a false statement, or leak requests. Every member verifies orders and aggregate statements independently. Invalid partials and signatures are rejected. Threshold and fallback rules prevent one member from halting the system.

The privacy guarantee against a colluding quorum depends on the final cross-market construction. This trust assumption must be displayed until aggregate-only decryption is proven.

### Malicious user or prover

A user may attempt value creation, negative or overflowing values, stale-root spending, duplicate nullifiers, invalid markets, fee evasion, malformed ciphertexts, or cross-network replay. Circuit constraints, contract bounds, domain separation, root checks, nullifier uniqueness, and market registration reject these cases.

### Compromised frontend or backup service

A compromised frontend can steal secrets before proving. Reproducible builds, published artifact hashes, content security policy, dependency review, and hardware-wallet-visible deposit and withdrawal summaries reduce this risk. A backup service receives only opaque ciphertext and cannot become the source of truth.

### Governance compromise

Governance may attempt to register a malicious market, replace keys, redirect fees, or pause exits. Immutable vault domains and verification keys, delayed multisig changes, capability checks, public events, and exit-preserving pause rules limit the damage.

## Compliance and selective disclosure

- Testnet starts with an unrestricted policy and labels it clearly.
- The upstream Association Set Provider design is evaluated during the compatibility spike, not added casually after deployment.
- Any association or exclusion policy is immutable or delay-bound for already created notes so a policy change cannot trap existing user funds.
- New deposits may be policy-gated, but valid withdrawals and refunds cannot depend on a permanently available administrator.
- Optional viewing keys and user-generated disclosure bundles may let a user prove their own activity to an auditor without exposing other users.
- Social accounts, sanctions screening, and market eligibility must not become plaintext trading-history databases.

## Actors

| Actor | Responsibility | Must not be trusted with |
|---|---|---|
| User wallet | Authorize deposits, derive recovery keys, choose final withdrawals | Plaintext note database outside the user's device |
| Browser prover | Create notes, proofs, encrypted intents, and recovery records | Long-lived plaintext secrets after the session is locked |
| ShieldedCollateralVault | Hold USDC, verify spends, update roots, reject nullifier reuse | Any administrator's private accounting decision |
| PrivateOrderRouter | Register approved markets and apply verified aggregate batches | User identity or plaintext individual orders |
| Relayer | Pay XLM fees and submit proof-bound actions | Ability to change recipient, outputs, market, amount, fee, or expiry |
| Committee member | Validate encrypted orders and batch statements | Enough information alone to decrypt individual orders |
| Witness indexer | Reconstruct commitment paths and serve checkpoints | Note secrets, spending keys, sides, or amounts |
| Resolution keeper | Submit oracle-backed resolution and TTL maintenance | Ability to choose an outcome outside resolver rules |
| Treasury | Own protocol fee notes and withdraw aggregated revenue | Ability to seize user notes or redirect principal |
| Governance | Control emergency and allowlist parameters through multisig and timelock | Ability to block withdrawals or refunds permanently |

## Target architecture

### ShieldedCollateralVault

One shared vault holds Circle USDC for all supported Moros markets on the same Stellar network.

Responsibilities:

- Accept public USDC deposits and append shielded output commitments.
- Verify private note spends.
- Maintain commitment roots and a bounded history of accepted roots.
- Maintain a spent-nullifier accumulator that cannot become reusable through TTL expiry.
- Append private balance, position, refund, payout, and treasury notes.
- Transfer public USDC only for deposits, aggregate market funding, aggregate market redemption, and final withdrawals.
- Expose permissionless recovery and withdrawal paths that do not require Moros services.

The vault must not store a per-wallet public balance.

### PrivateOrderRouter

The router connects shielded notes to registered LMSR markets.

Responsibilities:

- Maintain an allowlist of exact market contracts, collateral, resolver, close time, fee policy, and market state.
- Accept proof-bound order intents from the vault.
- Queue commitments without recording a public wallet owner.
- Validate threshold committee attestations or aggregate proofs.
- Apply aggregate market updates using the vault as the market batcher and funder.
- Mark position commitments included or refundable.
- Pull aggregate winning shares from resolved markets back into the vault.

New markets use the shared router as their batcher. Existing deployed markets remain on their current contracts until all existing positions are claimed or refunded.

### Relayer network

At least two interchangeable relayers submit the same signed intent format.

Each intent binds:

- Network passphrase.
- Vault contract.
- Operation type.
- Input nullifiers.
- Output commitments.
- Market and position commitment when applicable.
- Public withdrawal recipient and amount when applicable.
- Maximum relayer fee.
- Expiration ledger.
- Client-generated idempotency key.

A relayer may reject an intent, but it cannot modify it. The user can send the same valid intent to another relayer or submit it using a temporary Stellar account.

### Witness and history services

The contract is the source of truth. Indexers are replaceable accelerators.

- Commitment leaves, indices, roots, and encrypted output payloads must be recoverable from durable data.
- At least two indexers reconstruct the same roots independently.
- Every witness response includes the root and leaf index so the client can recompute and verify it locally.
- Indexer databases use durable storage, regular snapshots, and restore tests.
- RPC event retention alone is not an acceptable recovery plan.
- If contract storage cannot economically retain every leaf, signed checkpoint files and a reproducible history archive are mandatory before testnet release.

## Note model

Each note contains at least:

- Domain separator.
- Stellar network identifier.
- Vault contract identifier.
- USDC SAC identifier.
- Purpose: balance, position, refund, payout, treasury, or padding.
- Private value in USDC atomic units.
- Shielded owner public key.
- Random note identifier.
- Random blinding value.
- Optional market context hash for position notes.

The commitment must bind every field that changes authorization, value, asset, purpose, or market context.

The nullifier must be derived from the spending key, note identifier, leaf position or an equivalently unique domain, and vault domain. It must not be reusable across networks, contracts, or purposes.

Zero-value padding notes are permitted only if the circuit and contract use a fixed output shape and reject their use for value creation.

## Required proof statements

### Deposit proof

- The deposited USDC amount equals the value committed into output notes.
- Every output note uses the correct vault, network, and asset domain.
- Output commitments are well formed and distinct.

The deposit wallet and total amount remain public.

### Private transfer proof

- Every input note belongs to the prover.
- Every input commitment exists under an accepted root.
- Input nullifiers are derived correctly.
- Input value equals user output value plus an allowed shielded relayer fee note.
- Output commitments are well formed and distinct.
- The proof is bound to the operation context and expiration.

### Private order proof

- Inputs are valid unspent balance notes.
- Input value equals change value plus the private order budget and allowed fee.
- Side is binary.
- Order amount is positive, within market limits, and no greater than its private budget.
- Position commitment binds amount, side, market, fee policy, secret, and nullifier.
- The target market was approved and open at the bound ledger or close time.
- The encrypted order encodes the same amount and side as the position commitment.
- Change and position outputs are bound to this exact action.

### Batch proof or committee statement

- Every included order proof is valid.
- Every included commitment is pending and unique.
- Every order nullifier is unique.
- Aggregate YES and NO quantities equal the encrypted orders in the batch.
- Batch size satisfies the minimum anonymity rule.
- No order can be included twice.
- The statement is bound to one market, one batch epoch, and one router contract.

### Shielded claim proof

- The position commitment is included in a finalized batch.
- The position nullifier is derived correctly and unspent.
- The public market outcome and clearing price are bound into the proof.
- Payout and platform fee follow the exact LMSR entitlement formula.
- Principal and void refunds are not charged.
- Payout, change, fee, and padding notes conserve the proven entitlement.
- Output notes return value to the user's shielded key and the treasury's shielded key.

No USDC is transferred to a public wallet during a shielded claim.

### Withdrawal proof

- Inputs are valid unspent balance or payout notes.
- Input value equals public withdrawal amount plus private change plus an allowed shielded relayer fee note.
- Recipient, amount, relayer rules, vault, network, and expiry are proof-bound.
- Nullifiers are unique and outputs are well formed.

The recipient and withdrawn amount are public.

## State machines

### Note lifecycle

| State | Allowed transition | Caller | Failure recovery |
|---|---|---|---|
| Available | Reserve locally for an intent | Browser | Unlock if no submission exists |
| Reserved | Submit proof-bound intent | Any relayer | Retry another relayer with the same intent |
| Submitted | Confirm nullifier and outputs | Reconciler | Poll chain and indexers by idempotency key |
| Spent | Discover output notes | Wallet scanner | Restore from encrypted output events and checkpoints |
| Output available | Spend, claim, or withdraw | User through any relayer | Same as available |

The chain nullifier set is authoritative. Local locks prevent accidental double submission but never decide ownership.

### Order lifecycle

| State | Transition | Caller and incentive |
|---|---|---|
| Intent prepared | Submit to queue | User wants the bet and relayer earns a fee |
| Pending | Include in a valid batch | Committee and batch caller earn configured service compensation |
| Pending after deadline | Refund into a shielded note | User recovers funds or a relayer earns the allowed fee |
| Included | Wait for resolution | No transaction required |
| Included and resolved | Claim into shielded balance | User recovers entitlement or a relayer earns the allowed fee |
| Voided | Refund into shielded balance | User recovers full principal |
| Claimed or refunded | Terminal | Every replay must fail |

### Market lifecycle

The existing open, closed, final-batch, awaiting-oracle, resolved, and void states remain. All time-based transitions must be permissionless and callable by more than one keeper. No state may require the original market creator to return.

## Multi-user concurrency requirements

- Proofs may reference a recent accepted root instead of only the latest root.
- The contract keeps a bounded root history sized from measured proving and submission latency.
- Nullifier checks make concurrent spends deterministic: at most one spend succeeds.
- Output insertion is atomic with input nullification.
- A failed cross-contract market call reverts nullifiers and outputs in the same transaction.
- The browser writes an encrypted intent journal before any submission.
- Multiple tabs and devices reconcile against chain state before selecting notes.
- Relayer endpoints use idempotency keys and return the same result for safe retries.
- Queue capacity and backpressure are per vault and per market, not global process memory only.
- Shared state is divided into bounded storage keys to avoid oversized entries and unnecessary footprint contention.
- A load benchmark determines whether one USDC vault is sufficient. Sharding is allowed only if a measured limit requires it because every shard reduces the anonymity set.

## Solvency invariants

- Public vault USDC assets plus collectible market assets must cover all shielded liabilities and accrued shielded fees.
- Deposits increase assets and shielded liabilities by exactly the same public amount.
- Private transfers do not change total liability.
- Orders transform balance liability into position liability without creating value.
- Aggregate market funding equals the LMSR cost returned by the market contract.
- Market resolution adds only the shares and collateral owed by the LMSR market.
- Claims transform a valid position entitlement into user and treasury notes exactly once.
- Withdrawals decrease assets and shielded liabilities by exactly the public withdrawal plus allowed relayer fee.
- Void and never-included refunds return full principal with no platform fee.
- Protocol fees can never be withdrawn from user principal.
- Integer ranges, decimal conversion, rounding direction, and field bounds are identical across circuits, contracts, committee code, and UI estimates.

These invariants require unit, sequence, fuzz, and stateful property tests. A spreadsheet or JavaScript estimate is not sufficient evidence.

## Liveness and emergency rules

- New deposits and new orders may be paused by a multisig during an incident.
- Private transfers, refunds, claims, and withdrawals must remain available whenever their proofs are valid.
- If all relayers fail, users can export the signed intent or submit from a temporary account.
- If the committee cannot form a batch before the finalization deadline, pending orders become shielded-refund eligible.
- If the oracle cannot resolve within the recovery window, the market follows the existing void path.
- If indexers fail, users can rebuild from durable checkpoints and onchain data.
- If the frontend disappears, the note format, circuits, proving artifacts, contract interface, and recovery CLI remain public and reproducible.
- Governance cannot change a note's asset, fee formula, market context, or owner after commitment.

## Recovery and backup

- Derive shielded spending and viewing keys from a fixed, domain-separated wallet signature and verify deterministic recovery across every supported wallet.
- Encrypt note secrets locally before any chain or relayer submission.
- Emit encrypted output-note payloads that only the viewing key can discover and decrypt.
- Default recovery uses wallet-key scanning plus durable commitment checkpoints.
- Optional cloud backup stores only opaque encrypted blobs and sync counters. It must not store market, pool, transaction, side, amount, secret, or nullifier metadata in plaintext.
- Private backup synchronization uses an opaque capability identifier and proof of sync-key possession, not the social wallet JWT or wallet address.
- Cloud backup failure must not prevent deposits, bets, claims, refunds, or withdrawals.
- Exported recovery files are encrypted and bound to network and vault.
- Recovery testing must include a clean browser, a second device, deleted local storage, an unavailable Supabase project, and an indexer restored from snapshot.

## Privacy-safe service policy

- Never log proof witnesses, note plaintext, spending keys, side, exact amount, or decrypted individual order data.
- Redact proofs, public signals, commitments, nullifiers, authorization entries, and request bodies from default logs.
- Use short retention for IP and request metadata and document the exact retention policy.
- Separate social accounts and comments from private trading storage.
- Do not use wallet addresses as primary keys for note synchronization.
- Provide multiple relayer endpoints and permit direct self-submission.
- Rate-limit with idempotency keys and spent-nullifier checks where possible, not permanent wallet profiling.

## Governance and upgrade boundary

- Use a Stellar multisig and timelock for market registration, fee caps, relayer policy, and emergency pause.
- Configuration changes emit public events and have delayed activation.
- The pause cannot block exits.
- Verification keys are immutable per deployed vault. A new ceremony requires a separately deployed vault and an explicit user migration path.
- No user-facing contract names or UI labels use artificial release numbering before Moros has launched.

## Testnet release gates

The feature is not testnet ready until all gates pass:

1. At least 100 simulated users create, spend, claim, refund, and withdraw notes without lost or duplicated value.
2. At least 20 clients submit concurrently with stale but accepted roots and deterministic nullifier conflict handling.
3. At least 1,000 order intents pass load and recovery testing with measured queue, proving, submission, and finality latency.
4. Two relayers and two independently rebuilt witness services produce equivalent accepted results.
5. A browser crash at every step of the intent journal recovers without losing spendable outputs.
6. A committee member outage, relayer outage, keeper outage, RPC lag, duplicate request, stale root, and indexer restore are exercised.
7. Every contract transition has valid, invalid, boundary-time, replay, and overflow tests.
8. Stateful invariant tests preserve USDC solvency across arbitrary action sequences.
9. Public-ledger trace review cannot map a post-deposit bet or shielded claim to a wallet from protocol fields alone.
10. UI copy and documentation match the honest privacy contract in this specification.

## Mainnet prohibition

Mainnet deployment is blocked until:

- The chosen upstream primitives and licenses are reviewed and pinned.
- The final circuits and contracts complete an independent trusted setup when required.
- Independent reviewers audit circuits, Soroban contracts, relayer validation, note recovery, and solvency.
- All critical and high findings are fixed and retested.
- A public testnet period demonstrates multi-user load, recovery, privacy boundaries, and incident response.
- Committee members and relayers are operated by independent parties.
- A legal review covers privacy, sanctions, and jurisdictional obligations for the intended launch markets.
