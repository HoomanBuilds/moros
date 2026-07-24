# Multi-user shielded collateral privacy specification

## Status

Design for testnet implementation. This document does not claim that the current deployment provides shielded balances or unlinkable wallet activity.

Permissionless LP funding, variable LP value, active exit limits, creator-free funding, execution fees, and uniform fixed-lot batch pricing are defined by the companion specification `docs/specs/2026-07-23-permissionless-liquidity-and-private-batch-pricing.md`. That companion supersedes creator-subsidy and order-allocation statements in this document for new LP-backed markets.

Reusable note selection, one-input private actions, hidden variable whole-position quantities, and aggregate-only threshold decryption are defined by `docs/specs/2026-07-23-reusable-private-balance-and-variable-positions.md`. That specification supersedes fixed-position and combined-committee-secret implementation choices.

## Objective

Moros will let many users deposit Stellar USDC into one shared shielded collateral vault, reuse private balances across markets, place bets without signing from their public wallet, receive refunds and payouts back into shielded balances, and withdraw later through a relayer.

A restored browser may ask the wallet for one deterministic, domain-separated signature to unlock shielded keys. That signature is local authentication and key recovery, not authorization for an individual bet, claim, refund, or withdrawal transaction.

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
- The current pool stores one latest market price, so a later batch can overwrite the price used to calculate an earlier position's entitlement.
- The current market has creator-only funding, no LP shares, no active exit queue, and no terminal path to distribute remaining reserve after the sole batcher redeems a resolved market.

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
- https://developers.stellar.org/docs/build/guides/conventions/deploy-contract
- https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/persisting-data

## Honest privacy contract

### Hidden from a public ledger observer after shielding

- The wallet that placed a particular bet.
- The wallet's current shielded USDC balance.
- The actual USDC execution charge and unused private position budget. The first release publishes a fixed lot class shared by every order in a batch.
- The selected side.
- The link between a shielded balance note and its change note.
- The link between a position and a later shielded payout note.
- Individual fee amount when the fee remains a shielded treasury note.
- The link between a refund and the original wallet.
- The decrypted contents of the user's backed-up activity archive, including private bets, LP notes, claims, refunds, and local status history.

### Public by design

- The wallet, amount, and time of a deposit from public USDC into the vault.
- The recipient, amount, and time of a final withdrawal to a public Stellar wallet.
- A market creator's address, configuration, rules hash, liquidity target, and proposal.
- Aggregate market liquidity, LP share supply, scenario equity, and exit-queue totals.
- Each first-release LP funding transaction's target market, time, and aggregate funded delta.
- The shared vault contract, supported asset, commitment roots, output commitments, and spent nullifiers.
- The markets updated by each aggregate batch.
- The target market and timing of each first-release relayed order intent, without a public user wallet, side, or amount.
- The market or batch context and timing of a shielded claim or refund, without the private position commitment, public user wallet, or value.
- Aggregate YES and NO changes applied to each market.
- The fixed lot identifier and order count for an executed batch.
- Market odds, close time, outcome, resolver evidence, and aggregate solvency data.
- The relayer account that submits an action.
- A user's created market and creator address, because market proposals are public on Stellar.

### Privacy that depends on usage

- Deposit-to-bet unlinkability depends on other deposits, time separation, fixed action shapes, and relayer batching.
- A user who deposits and immediately performs a unique action has a weak anonymity set.
- A user who withdraws an exact unique amount immediately after a payout can create a timing and amount correlation.
- The first testnet release hides the wallet-to-market link from the public ledger. It does not hide the selected market from the relayer service or hide that a relayed intent targeted that market.
- Client-side encryption prevents Supabase operators from reading archive contents, but it does not hide the existence, IP address, timing, opaque bucket grouping, or padded size class of synchronization requests.
- Full market-choice privacy requires cross-market encrypted batching and is a separate release gate.

### Not promised

- Hiding the existence of a public USDC deposit or withdrawal.
- Hiding a market creator or public proposal.
- Hiding aggregate LP funding and solvency values.
- Privacy from a compromised browser or wallet.
- Privacy from traffic analysis by a relayer that records IP addresses.
- Privacy from traffic analysis by the hosting provider, Supabase, RPC provider, or a party correlating synchronization time with public transactions.
- Privacy from a colluding threshold committee if the selected cryptographic mode lets a quorum reconstruct individual data.
- Hiding the creator of an onchain market proposal.
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

A note-specific witness request can still link an IP address to a commitment or leaf. The default wallet scans fixed public ranges or requests padded cover sets instead of querying one private leaf from a known wallet session. A user may run the public rebuild CLI or a local indexer. Private information retrieval is not claimed until a separately reviewed construction exists.

### Malicious committee member

One member may refuse, return a bad partial decryption, sign a false statement, or leak requests. Every member verifies orders and aggregate statements independently. Invalid partials and signatures are rejected. Threshold and fallback rules prevent one member from halting the system.

The privacy guarantee against a colluding quorum depends on the final cross-market construction. This trust assumption must be displayed until aggregate-only decryption is proven.

### Malicious user or prover

A user may attempt value creation, negative or overflowing values, stale-root spending, duplicate nullifiers, invalid markets, fee evasion, malformed ciphertexts, or cross-network replay. Circuit constraints, contract bounds, domain separation, root checks, nullifier uniqueness, and market registration reject these cases.

### Compromised frontend or backup service

A compromised frontend can steal secrets before proving. Reproducible builds, published artifact hashes, content security policy, dependency review, and hardware-wallet-visible deposit and withdrawal summaries reduce this risk. A backup service receives only opaque ciphertext and cannot become the source of truth.

A Supabase administrator may read, replace, roll back, correlate, or delete every stored row. Client-side authenticated encryption prevents plaintext disclosure and undetected field modification. Chain reconciliation prevents a forged archive status from authorizing value movement. Supabase deletion or rollback must not make funds unrecoverable because note discovery and spent state remain reconstructable from the wallet-derived viewing key and durable ledger data.

### Governance compromise

Governance may attempt to register a malicious market, replace keys, redirect fees, or pause exits. Immutable vault domains and verification keys, delayed multisig changes, capability checks, public events, and exit-preserving pause rules limit the damage.

### USDC issuer and Stellar network risk

The vault cannot prevent Circle or Stellar network controls from freezing, clawing back, pausing, or otherwise affecting the configured USDC asset. The exact SAC and issuer must be displayed and verified at deployment. Moros must not describe shielded notes as censorship-proof USDC or promise withdrawals while the underlying asset or network is unavailable.

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
| MarketFactory | Permissionlessly record supported proposals and deploy the approved LMSR template after an isolated liquidity vault reaches its target | User note secrets, shared-vault custody, or authority to allocate LP capital outside the approved rules |
| MarketLiquidityVault | Accept permissionless USDC funding, issue LP share notes, process exits, and receive terminal LP equity for one market | Bettor collateral or authority to dilute active LP shares at an unreviewed price |
| ShieldedCollateralVault | Hold USDC, verify spends, register exact markets, apply batches as the sole batcher, hold aggregate shares, and reject nullifier reuse | Any administrator's private accounting decision |
| Private order coordinator | Persist opaque intents, form fair batches, and collect threshold attestations | Custody of USDC or authority to change vault state without the mandatory proof and required attestation |
| Relayer | Pay XLM fees and submit proof-bound actions | Ability to change recipient, outputs, market, amount, fee, or expiry |
| Committee member | Validate encrypted orders and batch statements | Enough information alone to decrypt individual orders |
| Witness indexer | Reconstruct commitment paths and serve checkpoints | Note secrets, spending keys, sides, or amounts |
| Private sync gateway | Verify opaque capability signatures, strip browser network metadata from Supabase requests, and enforce fixed request shapes | Wallet identity, archive plaintext, recovery signature, derived keys, or authority to forge an archive page |
| Encrypted sync service | Store opaque fixed-size activity pages and compare-and-swap generations | Wallet identity, market, pool, transaction, commitment, side, value, note secret, or decrypted status |
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
- Maintain a TTL-safe spent-nullifier set that cannot become reusable through archival or expiry and does not require every user to prove against one mutable global nullifier root.
- Maintain a per-market accepted-position root, a sparse included-position set root updated by each batch, per-batch allocation roots, and sealed final roots after batching closes.
- Append private balance, position, refund, payout, and treasury notes.
- Accept user-created markets only through the approved noncustodial factory, which proves approved WASM and atomically binds immutable collateral, vault batcher, liquidity vault, resolver, close time, fee policy, rules hash, LMSR parameters, and a fully funded LP reserve.
- Act as the configured batcher for every new private LMSR market.
- Transfer public USDC only for deposits, proof-bound LP funding and exits, aggregate market charges, aggregate market redemption, fee settlement, and final withdrawals.
- Hold all aggregate YES and NO shares, per-batch allocation roots, and market settlement receipts.
- Expose permissionless recovery and withdrawal paths that do not require Moros services.

The vault must not store a per-wallet public balance.

### MarketFactory

Any user can call the factory to propose a supported market without supplying USDC. Anyone may then fund its isolated market liquidity vault. After the public target is reached, any caller may activate the proposal. Activation deploys an approved LMSR WASM hash, completes all immutable or one-time configuration, transfers the LP reserve, and registers the market with the shared vault in one transaction. A failed nested step reverts the full invocation, so it cannot leave a funded but partially linked market.

The factory is not a public listing service and does not custody user shielded balances. Offchain metadata publication may be retried without creating another proposal, redeploying contracts, or moving LP funding again. A Supabase listing failure cannot change whether the onchain market is valid.

The vault does not trust a market's self-reported code identity. Registration requires an authenticated factory deployment record plus live cross-contract checks for vault batcher, liquidity vault, USDC, resolver, timing, fee, rules hash, funded loss bound, and supported capability. Governance may change approved capability policy only through the defined timelock. It does not approve individual markets.

### Onchain routing boundary

Routing and custody remain in the same vault contract for the first implementation. The routing code is a separate Rust module, not a separately deployed custody contract.

Responsibilities:

- Maintain approved factory, template hashes, resolver capabilities, collateral, timing bounds, fee caps, and market state.
- Let any user create and atomically register a market through the approved factory when every onchain capability check passes. Registration must not require a Moros operator to approve each market.
- Accept proof-bound order intents and consume their balance-note inputs atomically.
- Queue commitments without recording a public wallet owner.
- Validate a mandatory aggregate proof plus the threshold committee statement required by the selected encryption mode.
- Authorize the exact USDC transfer and call each market as that market's configured batcher.
- Mark position commitments included or refundable.
- Redeem aggregate winning shares into the same vault exactly once.
- Return terminal market-maker equity to the linked market liquidity vault only after aggregate winner redemption and without touching user backing.

This boundary matches the current LMSR interface, where the configured batcher funds `apply_batch`, receives both outcome shares, receives the batch-collateral refund on VOID, and redeems the winning shares. Splitting custody into a second deployed router would create an unnecessary USDC and share handoff. If measured contract limits later require a split, implementation stops until an exact, atomic, audited custody interface replaces this design.

New markets use the shared vault as their batcher. Existing deployed markets remain on their current contracts until all existing positions are claimed or refunded.

### Private order coordinator

At least two interchangeable offchain coordinator instances accept the same opaque intent format, persist idempotent jobs, form fair per-market batches, and collect committee attestations. A coordinator never holds USDC or LMSR shares. Any relayer can submit the mandatory proof and required threshold statement to the vault, and an unavailable coordinator cannot block a deadline refund.

### Committee key lifecycle

The threshold key uses a reviewed distributed key-generation protocol with no single dealer learning the combined secret. The published epoch record binds network, vault, encryption suite, threshold, member set, member verification shares, transcript hash, proof-of-possession results, activation ledger, and retirement policy.

Invalid shares, missing proofs, transcript disagreement, duplicate members, identity points, wrong-subgroup points, and unresolved DKG complaints block epoch activation. Secret shares never enter application logs, Supabase, browser storage, general service backups, container images, or source control.

Every order binds the active committee key epoch. A new epoch accepts new orders only after its full transcript is registered. An old epoch remains available to process or refund its already accepted orders. Rotation cannot reinterpret ciphertexts, silently reduce the threshold, or delete the old refund path. Emergency member loss may stop execution, but it cannot stop permissionless deadline refunds.

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
- Exact accepted relayer quote or maximum relayer fee.
- Relayer fee-note key, quote ID, quote expiry, and permitted operation.
- Expiration ledger.
- Client-generated idempotency key.

A relayer quote is signed by the relayer and cannot be reused for another vault, operation, or action. A relayer fee note is created only if the bound action succeeds atomically. Testnet relayers may quote zero. Mainnet operator compensation and XLM replenishment must be measured and approved before activation rather than hidden in user principal.

A relayer may reject an intent, but it cannot modify it. The user can send the same valid intent to another relayer or submit it using any funded Stellar account because private note ownership is proven to the vault instead of authorized by a public user address. The self-submission source account is public and may create an offchain correlation if it is the user's known wallet.

### Witness and history services

The contract is the source of truth. Indexers are replaceable accelerators.

- Commitment leaves, indices, roots, and fixed-length encrypted output payloads must be recoverable from durable data.
- At least two indexers reconstruct the same roots independently.
- Every witness response includes the root and leaf index so the client can recompute and verify it locally.
- Indexer databases use durable storage, regular snapshots, and restore tests.
- RPC event retention alone is not an acceptable recovery plan.
- The default design stores the fixed-length encrypted output envelope in persistent contract storage by leaf index so archived entries can be restored.
- If measured cost makes per-output contract storage infeasible, the replacement must use at least two independently operated raw-ledger archives, hash-addressed checkpoints verified back to onchain roots, and a public rebuild CLI. A Moros-signed checkpoint alone is not an acceptable source of truth.
- Recovery testing includes a wallet that was offline longer than the public RPC retention window.

### Encrypted activity archive and Supabase boundary

Supabase is an encrypted synchronization and recovery cache. It is not the source of truth for note ownership, market state, claims, refunds, or LP value.

The current `private_positions` format is not acceptable for the target privacy model because it stores wallet, commitment, market ID, pool ID, transaction hash, and exact placement time as plaintext columns. Row-level security protects users from other application users, but it does not hide those fields from Supabase administrators or a compromised service role.

The replacement uses two logically isolated stores:

1. The public social and market catalog keeps profiles, comments, images, watchlists, and public market metadata. It may be linked to a wallet because those features are intentionally public.
2. The private activity archive uses a separate client, separate session or capability, separate tables, and no foreign key to a social user, wallet, profile, comment, or public market row.

The browser does not access private archive tables through the wallet-linked Supabase client. It sends fixed-shape encrypted requests to a private sync gateway. The gateway verifies the opaque signed capability, strips browser cookies and identity headers, disables body logging, and writes through a server-only Supabase role. Supabase therefore sees the gateway and opaque archive identifiers rather than the user's browser address. The gateway can still observe request IP and timing, so it is a metadata trust boundary and not an anonymity network.

The private archive stores only:

- A random opaque bucket identifier derived from a private sync key.
- A public sync-verification key or equivalent one-way capability verifier.
- A random page identifier.
- A schema and cipher-suite version.
- A compare-and-swap generation.
- A fixed-size padded authenticated ciphertext, nonce, and ciphertext hash.
- Minimal server timestamps and retention fields required to operate the free Supabase deployment.

It must not store wallet, market, pool, transaction hash, commitment, nullifier, note purpose, side, amount, payout, claim state, LP share, exit terms, or exact action time in plaintext. It must not use the wallet address as a row key, auth email, storage path, query filter, log tag, or analytics identity.

The wallet derives one recovery root from a dedicated deterministic signature whose message is separated from social sign-in and transaction authorization. The signature never leaves the browser. HKDF or an equivalently reviewed KDF derives separate encryption, bucket, request-signing, and export keys bound to the Stellar network, vault, schema, and wallet. Every supported wallet must reproduce the exact signature before private sync is enabled. Wallets that cannot do so need an explicit encrypted recovery-secret flow and cannot be presented as automatically recoverable.

Sync requests prove possession of the opaque sync key and bind method, bucket, generation, body hash, nonce, and expiry. The gateway consumes each nonce once under a bounded retention window. Requests do not reuse the social wallet JWT or send a reusable raw capability in request bodies or URLs. Replay, stale generation, wrong bucket, and modified ciphertext fail. The Supabase service role stays server-only and is never embedded in the app.

Archive pages use a reviewed AEAD with unique nonces, authenticated schema and domain data, fixed-size padding, and an encrypted manifest. Pages pack multiple activity records and dummy slots so one row does not equal one bet. Immediate encrypted intent-journal backup may still expose that some private activity occurred at that time. Periodic batching and random user-controlled delay reduce correlation only when they do not risk losing a newly created secret.

The decrypted archive may contain:

- Markets the wallet created, while clearly marking that creation itself is public onchain.
- Shielded deposits and withdrawals.
- Private pending and executed positions.
- Execution-change notes.
- Claims, losses, refunds, and VOID recovery.
- LP funding notes, queued exits, replacement matches, fees, and terminal redemptions.
- Chain receipts, local intent state, and recovery checkpoints.

Archive status is advisory until reconciled with contract roots, nullifiers, batch records, and market state. A clean device downloads opaque pages, decrypts locally, validates every record, scans durable ledger outputs, reconciles terminal status from chain, and then renders history. Supabase never receives the decrypted filter for a market, status, side, or amount.

Multi-device writes use optimistic compare-and-swap. On a generation conflict, the client downloads, decrypts, validates, merges by cryptographic action ID and chain finality, creates a new encrypted manifest, and retries. A client timestamp alone never overrides a chain-confirmed terminal state.

There is no earlier testnet history migration. The fresh shared-vault deployment disables writes to `private_positions`, removes its browser code and live table, deploys the opaque archive schema, and starts empty history under the canonical vault domain. The application, Supabase projects, deployment manifests, and VM runtime do not import or list positions, markets, notes, or service state from earlier test deployments.

Plaintext metadata already handled by the provider may remain in provider backups or logs until their retention expires. Deleting the live testnet table does not undo that historical exposure, so Moros cannot retroactively describe the old backup format as private from Supabase operators.

This design uses ordinary encrypted Postgres rows or objects, row-level security, and bounded API functions available on the free Supabase plan. It does not depend on paid analytics, point-in-time recovery, or private infrastructure. Because a free project may pause or lose availability, durable ledger recovery and encrypted user export remain mandatory.

## Note model

Each note contains at least:

- Domain separator.
- Stellar network identifier.
- Vault contract identifier.
- USDC SAC identifier.
- Purpose: balance, position, service escrow, operator compensation, refund, payout, treasury, or padding.
- Private value in USDC atomic units.
- Shielded owner public key.
- Random note identifier.
- Random blinding value.
- Market, order deadline, fee policy, batch policy, and encrypted-order hash for position notes.

The commitment must bind every field that changes authorization, value, asset, purpose, or market context.

The nullifier must be derived from the spending key, note identifier, leaf position or an equivalently unique domain, and vault domain. It must not be reusable across networks, contracts, or purposes.

The first implementation stores each spent nullifier under its own persistent key and never deletes it. Relayers and the recovery CLI restore an archived key before retrying an action; an archived persistent entry must never be interpreted as absent. This avoids a single global nullifier-root write conflict while preserving double-spend safety. The compatibility spike must reconfirm this archival behavior on the active Stellar protocol.

An input-note nullifier is published when a private order is accepted and prevents the funding balance from being reused. The position note has a different nullifier that is not published until the position is claimed or refunded. Batch inclusion uses the position commitment or an action ID, never a prematurely published position nullifier.

One position has exactly one terminal nullifier across winning claim, losing recovery, pending refund, and VOID refund paths. The operation type cannot change that nullifier. This prevents a position from taking two different terminal paths.

Every output uses a reviewed authenticated-encryption envelope with an ephemeral key, nonce, fixed-length ciphertext, and no stable public viewing-key identifier. The compatibility decision fixes the exact scheme. A contract event or storage record must never contain note plaintext or a variable length that reveals note purpose or value.

Order acceptance appends the public position commitment to that market's accepted-position tree. Each batch proof changes the selected keys in a sparse included-position set from absent to present and creates the batch allocation root. At or after the finalization deadline, one transaction closes batching and seals the final accepted and included roots before any pending refund. A pending refund proves accepted membership plus included non-membership under those sealed roots. An included claim or VOID refund proves membership under its batch allocation root. Every terminal action publishes only a unique position nullifier. The TTL-safe nullifier set prevents replay without changing a shared position root for each user action.

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
- Input value equals change value plus the exact private position budget, any future service escrow, and the authorized relayer fee.
- Side is binary.
- The public lot identifier selects a positive whole-share quantity within market limits, and the private USDC budget covers its maximum price, trade-fee cap, and any authorized service fee.
- Every position inside one first-release batch uses the same fixed lot. Finer share precision and mixed-lot batches stay disabled until aggregate conversion and allocation tests prove no liability or privacy gap.
- Position commitment binds amount, side, market, close and refund deadlines, fee policy, batch policy, secret, and its future spend-nullifier derivation.
- The target market is approved and still open at transaction execution. A proof generated before close cannot be accepted after close.
- The encrypted order encodes the same amount and side as the position commitment.
- Change and position outputs are bound to this exact action.

### Batch proof and committee statement

- Every included order proof was verified at onchain acceptance.
- Every included commitment is pending and unique.
- Every input-note nullifier was consumed when its order became pending, and no position commitment or action ID is included twice.
- Aggregate YES and NO quantities equal the encrypted orders in the batch.
- Batch size satisfies the minimum anonymity rule and both aggregate YES and NO quantities are nonzero.
- Batch size is at least eight and each side contains at least two positions.
- The included set contains every eligible commitment accepted for the bounded market epoch, with no coordinator-selected omission.
- No order can be included twice.
- The batch-specific execution record publishes order-independent uniform YES and NO prices plus the fixed-lot charge for each hidden side.
- User side charges plus the explicit bounded protocol rounding contribution sum exactly to the LMSR charge returned by the market.
- Gross position entitlements equal the batch backing for both possible outcomes at USDC atomic precision.
- Every included position exists in the accepted-position tree and changes from absent to present under the current sparse included-position root.
- If nonzero service fees are enabled later, the proof consumes each included service-escrow note and creates only the configured operator compensation notes. Zero-fee testnet batches create no operator value.
- One batch allocation root binds every included position commitment, uniform side charges, lot, service-escrow result, market, pre-state, post-state, and epoch. The statement is bound to that root and the vault contract.
- The proof links the exact accepted ciphertext set to its homomorphic sum and verifies correct aggregate threshold decryption against the public DKG transcript and member verification shares.

The vault always verifies the aggregate proof. A threshold committee statement authenticates participation and liveness, but signatures alone cannot establish aggregate correctness. The selected encryption construction must provide verifiable homomorphic aggregation and verifiable threshold decryption. A colluding quorum may still violate the stated order-privacy trust boundary by decrypting individual ciphertexts, but it cannot create a valid false aggregate accounting transition.

A set containing orders for only one outcome is not a private batch because its public aggregate reveals every side. Those orders stay pending and become privately refundable after the deadline.

The first shared-vault testnet requires at least eight positions and at least two positions on each side. Resource benchmarks may increase that floor but cannot reduce it. There is no short final batch. A participant coalition that knows all other orders can still infer the remaining side, so this is a public-observer privacy floor rather than an absolute anonymity promise.

### Shielded claim proof

- The private position data is a member of the finalized batch allocation root without revealing the position commitment or side.
- The position nullifier is derived correctly and unspent.
- The public market outcome and the batch's uniform side charges are bound into the proof.
- An executed-order change proof returns private position budget minus side charge, escrowed trade fee, and earned service fee before resolution.
- A resolution claim creates only the winning-share credit, if any, because trade fees were escrowed at execution.
- Principal and void refunds are not charged.
- Payout, change, and padding notes conserve the proven entitlement.
- Output notes return user value to the user's shielded key. Vested protocol and LP fee distribution follows the aggregate fee escrow transition.

No USDC is transferred to a public wallet during a shielded claim.

### Shielded refund proof

- The private position commitment is a member of an eligible pending or VOID set without revealing the commitment itself.
- A pending-order refund is accepted only at or after its onchain deadline and only if the position was never included.
- A VOID refund returns the full position budget after the market has returned aggregate batch collateral to the vault.
- An unbatched refund also returns any locked service escrow because no batch service was completed.
- No trade or platform fee is charged. An optional relayer fee must be separately authorized and a zero-relayer-fee direct submission remains possible.
- The position nullifier is consumed once and the refund output returns to the user's shielded key.
- A pending refund proves private membership in the sealed accepted-position root and private non-membership in the sealed included-position root. An included VOID refund proves private membership in its batch allocation root. Both consume the unique position nullifier.

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
| Pending | Include in a valid mixed batch | Committee and batch caller earn configured service compensation; any relayer can submit the mandatory proof and required threshold statement |
| Pending after deadline | Refund into a shielded note | User recovers funds or a relayer earns the allowed fee |
| Included | Wait for resolution | No transaction required |
| Included and resolved | Aggregate redeem, then claim into shielded balance | Any caller restores vault backing; the user recovers entitlement or a relayer earns the allowed fee |
| Voided | Refund into shielded balance | Market returns batch collateral atomically; the user recovers full principal and refundable trade fee |
| Claimed or refunded | Terminal | Every replay must fail |

### Market lifecycle

| Transition | Caller | Incentive | Failure recovery |
|---|---|---|---|
| Proposal to funding | Any user through the approved factory | Creator wants the market available | The creator retries without moving USDC |
| Funding to deployed and registered | Any caller after the LP target is reached | LPs and creator want the market active | The full atomic activation reverts on failure without losing proposal funding |
| Open to final batching | Any coordinator or relayer after close | Submitter compensation or participant recovery | Another submitter uses the same public state |
| Pending to final roots sealed | Any caller after finalization deadline | User recovery or allowed relayer fee | Another user, relayer, or keeper submits the idempotent finalization call |
| Awaiting oracle to resolved | Any keeper with valid resolver evidence | Keeper compensation or protocol operation | Another keeper submits the same verifiable evidence |
| Awaiting oracle to void | Any caller after the resolver timeout under the configured resolver rules | Unlock refundable principal | User or independent keeper calls the timeout path |
| Resolved to aggregate redeemed | Any caller | Restore claim backing and bounded caller compensation | Another caller retries idempotently |
| Aggregate redeemed to LP equity settled | Any caller after the sole batcher claim is complete | LPs recover terminal market-maker value | LP or independent keeper retries |
| Any live state to TTL maintained | Any caller | Bounded maintenance compensation where configured | Entries remain restorable from archived persistent state |

All time-based transitions must be permissionless and callable by more than one keeper. No state may require the original market creator, Moros frontend, one committee server, or one relayer to return. Keeper and maintenance compensation is zero on the free testnet unless an explicitly funded budget is configured.

## Multi-user concurrency requirements

- Proofs may reference a recent accepted root instead of only the latest root.
- The contract keeps a bounded root history sized from measured proving and submission latency.
- Nullifier checks make concurrent spends deterministic: at most one spend succeeds.
- The finalization boundary rejects every later batch before it seals the accepted and included roots. Position nullifiers make concurrent claim and refund replays deterministic without forcing unrelated users to reprove against a changed position root.
- Output insertion is atomic with input nullification.
- A failed cross-contract market call reverts nullifiers and outputs in the same transaction.
- The browser writes an encrypted intent journal before any submission.
- Multiple tabs and devices reconcile against chain state before selecting notes.
- Relayer endpoints use idempotency keys and return the same result for safe retries.
- Queue capacity and backpressure are per vault and per market, not global process memory only.
- Shared state is divided into bounded storage keys to avoid oversized entries and unnecessary footprint contention.
- A load benchmark determines whether one USDC vault is sufficient. Sharding is allowed only if a measured limit requires it because every shard reduces the anonymity set.

## Solvency invariants

- Public vault USDC assets plus contract-enforced market receivables must cover all shielded liabilities and accrued shielded fees under every possible unresolved-market outcome.
- Deposits increase assets and shielded liabilities by exactly the same public amount.
- Private transfers do not change total liability.
- Orders transform balance liability into position liability without creating value.
- Aggregate market funding equals the LMSR cost returned by the market contract.
- A market receives only the exact atomic transfer for an accepted batch, capped by that batch's locked position budgets. The vault grants no reusable SAC allowance, so one market cannot draw collateral backing another market or balance note.
- Market resolution adds only the shares and collateral owed by the LMSR market.
- Claims transform a valid position entitlement into user and treasury notes exactly once.
- Withdrawals decrease assets and shielded liabilities by exactly the public withdrawal plus allowed relayer fee.
- Void and never-included refunds return full principal with no trade or platform fee.
- Protocol fees can never be withdrawn from user principal.
- Integer ranges, decimal conversion, rounding direction, and field bounds are identical across circuits, contracts, committee code, and UI estimates.

For each accepted batch `B`, all amounts are USDC atomic units:

- `S_B` is the sum of private position budgets locked by the included notes.
- `M_B` is the exact aggregate LMSR charge returned by `apply_batch`.
- `R_B` is the explicit protocol rounding contribution, with `0 <= R_B < batch_size`.
- `c_i` is the uniform fixed-lot atomic charge selected by position `i`'s private side, with `0 <= c_i <= amount_i` and `sum(c_i) + R_B = M_B`.
- `F_B` is refundable trade-fee escrow for the batch.
- `amount_i` is the position's winning-share credit in USDC atomic units under the enabled exact-conversion quantity rule.
- `W_B(YES)` and `W_B(NO)` are the aggregate market redemptions owned by the vault for each possible result.
- `E_B(outcome)` is the sum of gross user entitlements before platform and relayer fee allocation.

Every accepted batch requires `F_B >= R_B`. The executed-order change total is `S_B - (M_B - R_B) - F_B`. For normal resolution, total bettor value is that change plus `W_B(outcome)`, the rounding reserve first recovers `R_B` from vested fee escrow, and only `F_B - R_B` is split between LPs and the protocol. For VOID, the market returns `M_B`, the trade fee remains refundable, the rounding reserve recovers `R_B` from the market return, and bettor value returns to `S_B`. The contract accepts no batch statement that omits either non-void outcome check or the VOID equality.

For each user transition, output notes plus explicitly authorized service-fee notes must equal the proved value. A void or never-included refund has no trade fee. Market fixed-point conversion occurs before uniform fixed-lot atomic charge allocation. The explicit rounding contribution is bounded and separately funded. It is never silently reclassified as treasury revenue.

New LP-backed markets use the execution fee curve and LP split in `docs/specs/2026-07-23-permissionless-liquidity-and-private-batch-pricing.md`. Existing deployed markets retain their current fee policy for compatibility. Trading, protocol, LP, and service fees remain separate accounting classes.

Each batch stores its own exact batch allocation root and an informative average execution price. The allocation root is authoritative. The latest market spot price cannot determine an older position's entitlement.

These invariants require unit, sequence, fuzz, and stateful property tests. A spreadsheet or JavaScript estimate is not sufficient evidence.

## Liveness and emergency rules

- New deposits and new orders may be paused by a multisig during an incident.
- Private transfers, refunds, claims, and withdrawals must remain available whenever their proofs are valid.
- If all relayers fail, users can export the proof-bound intent or submit it from any funded Stellar account. The proof does not identify the note owner, but the public source account may weaken privacy and the recovery CLI must warn about that tradeoff.
- If the committee cannot form a batch before the finalization deadline, pending orders become shielded-refund eligible.
- If the oracle cannot resolve within the recovery window, the market follows the existing void path.
- If indexers fail, users can rebuild from durable checkpoints and onchain data.
- If the frontend disappears, the note format, circuits, proving artifacts, contract interface, and recovery CLI remain public and reproducible.
- Governance cannot change a note's asset, fee formula, market context, or owner after commitment.

## Operator incentives

- Free testnet relayers, coordinators, committee members, keepers, and TTL maintainers use zero service fees and explicitly pre-funded testnet XLM accounts.
- A future nonzero relayer fee requires the user's signed quote and is created only when that relayed action succeeds.
- A future batch service budget is locked in a separate shielded service-escrow note when the order is accepted. A valid batch may release only the proved configured amount to operator notes. If the order misses its deadline, the service escrow returns to the user with the position refund.
- Keeper or TTL bounties come from an explicit protocol operations reserve. They can never be minted from, charged against, or prioritized ahead of user backing.
- Mainnet activation is blocked until measured XLM costs, service budgets, fee beneficiaries, failed-action behavior, and operator withdrawal rules have exact tests. "Configured compensation" is not permission to add an administrator-controlled payment.

## Recovery and backup

- Derive shielded spending and viewing keys from a fixed, domain-separated wallet signature and verify deterministic recovery across every supported wallet.
- Treat that wallet signature as a local unlock and recovery action. Private vault actions use note proofs and do not include the wallet address in Soroban authorization entries.
- Encrypt note secrets locally before any chain or relayer submission.
- Emit fixed-length authenticated encrypted output-note payloads that only the viewing key can discover and decrypt, without publishing a stable viewing-key identifier.
- Default recovery uses wallet-key scanning plus durable commitment checkpoints.
- Optional cloud backup stores only opaque encrypted blobs and sync counters. It must not store market, pool, transaction, side, amount, secret, or nullifier metadata in plaintext.
- Private backup synchronization uses an opaque capability identifier and proof of sync-key possession, not the social wallet JWT or wallet address.
- Cloud backup failure must not prevent deposits, bets, claims, refunds, or withdrawals.
- Exported recovery files are encrypted and bound to network and vault.
- Recovery testing must include a clean browser, a second device, deleted local storage, an unavailable Supabase project, and an indexer restored from snapshot.

## Privacy-safe service policy

- Never log proof witnesses, note plaintext, spending keys, side, exact amount, or decrypted individual order data.
- Redact proofs, public signals, commitments, nullifiers, authorization entries, and request bodies from default logs.
- Disable third-party analytics, session replay, advertising pixels, and unredacted error reporting on private balance, portfolio, proof, backup, and recovery routes.
- Do not cache note plaintext, wallet signatures, derived keys, decrypted archives, proofs, or witnesses in a service worker, CDN, server component, browser URL, or crash report.
- Verify the hash manifest for public circuit WASM, proving keys, verification keys, and worker code before proving. Bind the expected artifact commitment to the immutable vault deployment or an independently signed deployment record so the same compromised frontend cannot replace both code and manifest. Public proving artifacts are safe to host, but an unverified replacement can steal witnesses.
- Use short retention for IP and request metadata and document the exact retention policy.
- Separate social accounts and comments from private trading storage.
- Do not use wallet addresses as primary keys for note synchronization.
- Do not reuse a social Supabase session, wallet-linked auth user, storage path, or database relation for the private archive.
- Provide multiple relayer endpoints and permit direct self-submission.
- Rate-limit with idempotency keys and spent-nullifier checks where possible, not permanent wallet profiling.

## Governance and upgrade boundary

- Use a Stellar multisig and timelock for market registration policy, approved capability hashes, fee caps, relayer policy, and emergency pause. Individual qualifying market registration remains permissionless.
- Configuration changes emit public events and have delayed activation.
- The pause cannot block exits.
- Verification keys, vault asset, treasury shielded key, and note domains are immutable per deployed vault. A new ceremony or treasury key requires a separately deployed vault and an explicit user migration path. Old treasury notes must remain spendable.
- Market fee policy and execution rules are immutable after the first order is accepted for that market.
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
11. Every accepted batch contains nonzero aggregate YES and NO quantities, while one-sided pending demand reaches a shielded full-refund terminal state.
12. Two positions from different batches settle using their own batch allocation roots, and their aggregate entitlements equal backing for YES, NO, and VOID.
13. A clean wallet that was offline longer than public RPC event retention restores from persistent or independently archived ledger data.
14. Terminal market-maker equity cannot reach the isolated liquidity vault before aggregate winning redemption and cannot reduce any user entitlement.
15. Every batch has at least eight positions, at least two positions per side, complete eligible-set inclusion, and verified aggregate decryption.
16. Supabase contains no plaintext wallet, market, pool, transaction, commitment, nullifier, side, value, action type, or exact action time for private archive records.
17. A clean device restores created-market, bettor, LP, change, claim, refund, and withdrawal history from opaque Supabase pages plus durable chain data.
18. Supabase deletion, rollback, duplicate pages, stale generations, ciphertext replacement, and social-account correlation do not lose funds, forge status, or expose archive plaintext.
19. The legacy `private_positions` client path and live table are removed before the new testnet starts, and no legacy row is imported into the opaque archive.

## Mainnet prohibition

Mainnet deployment is blocked until:

- The chosen upstream primitives and licenses are reviewed and pinned.
- The final circuits and contracts complete an independent trusted setup when required.
- Independent reviewers audit circuits, Soroban contracts, relayer validation, note recovery, and solvency.
- All critical and high findings are fixed and retested.
- A public testnet period demonstrates multi-user load, recovery, privacy boundaries, and incident response.
- Committee members and relayers are operated by independent parties.
- A legal review covers privacy, sanctions, and jurisdictional obligations for the intended launch markets.
