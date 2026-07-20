# Mainnet oracle readiness implementation plan

## Branch rule

All implementation stays on `feat/platform-hardening`. Do not merge into `main` until the user verifies the complete behavior and explicitly approves the merge.

## Goal

Make market availability reflect actual resolver capability. A user must never be able to create or fund a market that lacks a deployed resolver, supported source, active operator path, timeout, and refund path on the selected network.

## Phase 0: fail closed immediately

1. Add a network-scoped deployment schema for collateral, market and pool WASM hashes, treasury, committee, price resolver, event resolver, and every oracle contract.
2. Remove testnet resolver and oracle fallback IDs from mainnet builds.
3. Make a mainnet build fail validation if any required deployment is absent, malformed, or not readable through mainnet RPC.
4. Split testnet and mainnet asset coverage. Populate availability from verified network manifests rather than one shared static list.
5. Disable all event-market creation while no event observer, challenger, and arbitration service is operational.
6. Keep unavailable category cards visible only as clearly disabled coverage information. Do not label an unsupported draft as ready.
7. Add a server-side or contract-side deployment rejection so disabling the UI is not the only protection.

Acceptance:

- Selecting mainnet without complete mainnet contract IDs fails before wallet signing.
- Testnet contract IDs are rejected on mainnet.
- CHF and THB are not advertised from the verified mainnet Reflector fiat contract unless later live verification shows support.
- A direct call cannot create a Moros-recognized event market while its capability is disabled.

## Phase 1: capability registry and market factory

1. Add a Soroban capability registry contract.
2. Add a Soroban market factory that deploys only approved market and pool WASM versions.
3. Store network, template, resolver, collateral, operator threshold, timeouts, limits, and status in each capability.
4. Snapshot the capability ID and version into every created market.
5. Require the protocol registry, coordinator, keeper, and indexer to accept only factory-created markets.
6. Add a read-only capability endpoint that caches on-chain state for the frontend.
7. Refactor creation to render form fields from the selected active template.
8. Check capability status again immediately before the wallet signs.
9. Add a halt path for new markets and new orders that cannot block claims, refunds, challenges, votes, or timeout-to-VOID.

Acceptance:

- Unsupported templates fail in the UI, API, factory, and downstream services.
- A capability disabled after market creation stops new orders but preserves every settlement and recovery path.
- Rules, source priority, and capability version are immutable after the first accepted order.
- Users remain the creator and subsidy funder of every market.

## Phase 2: guarded price-market path

1. Add verified Reflector mainnet CEX, fiat, and Stellar DEX contract configuration.
2. Extend the oracle verification service to check network passphrase, contract existence, base asset, decimals, resolution, retention, exact asset list, latest positive value, and timestamp freshness.
3. Generate a signed or reproducible capability manifest from verified reads.
4. Add separate mainnet resolver and keeper deployments. Never reuse testnet deployment IDs.
5. Snap expiry to a compatible feed interval and keep the keeper safely inside one-day Reflector retention.
6. Add keeper rewards and a permissionless manual fallback.
7. Add a Band adapter for exact independently verified pairs, beginning with XLM and USDC.
8. Keep `pyth_pro` and DIA custom-provider modes compiled but disabled until their mainnet Stellar contracts and access are verified.
9. Add provider health, last update, retention deadline, resolution attempts, and VOID deadline to operations monitoring and market UI.

Acceptance:

- Every listed asset exactly matches the selected network's live oracle contract.
- Unsupported, stale, negative, wrong-base, missing-history, and excessive-deviation data cannot resolve funds.
- Reflector-only markets disclose one provider family.
- A two-provider market resolves only when the independent sources meet the configured quorum and deviation rules.
- If data remains unavailable until timeout, any account can VOID the market and every affected user can pull a full refund.

## Phase 3: native event oracle on testnet

1. Build a versioned source-adapter SDK.
2. Build an on-chain source and template registry linked to the capability registry.
3. Build observation workers with canonical response parsing, content hashing, signed observations, retries, and correction-window monitoring.
4. Store immutable evidence bundles in two independently recoverable locations and commit their content hash on-chain.
5. Build a proposer that requires matching worker observations.
6. Build an independent challenger that checks every proposal against its own observation path.
7. Build an arbitration console and signer service for YES, NO, and VOID votes.
8. Build permissionless finalization and timeout keepers.
9. Replace the flat event bond with template risk and maximum-liability based bonds.
10. Add a market-funded resolution budget for proposer, finalizer, watcher, and operator costs.
11. Increase event challenge and arbitration periods by template. The current one-hour period remains testnet-only.
12. Replace the evidence URL hash with an evidence bundle content hash.

Initial free-data templates:

- U.S. BLS series release thresholds using exact series IDs and first-release or revised-value rules
- U.S. NWS station observation thresholds using exact station, metric, unit, observation interval, and quality rules
- World Bank or FRED economic-series templates after release timing and revision behavior are tested
- One sports league or federation at a time after an official result source, terms, postponement rules, and backup source are verified

Sports must not launch as one broad capability. Each league, competition, and result type needs its own adapter or an active manual operator capability. Undocumented third-party sports endpoints are not accepted as the sole source of truth.

Acceptance for each template:

- Correct result resolves after the complete challenge period.
- Incorrect result is automatically challenged.
- Source disagreement enters a dispute and cannot silently select a winner.
- Postponed, abandoned, corrected, missing, malformed, rate-limited, and unavailable data follow the immutable rules.
- Operator quorum loss reaches VOID after timeout.
- Evidence remains verifiable if the original web page changes.
- Full creation, betting, final batching, proposal, challenge, vote, resolution, claim, VOID, and refund tests pass with testnet USDC.

## Phase 4: independent operations

1. Separate privacy committee, event observation, challenge, and arbitration roles.
2. Run at least five arbitration members under independent key and infrastructure control.
3. Run observation and challenge workers across independent providers and regions.
4. Add operator registration, delayed rotation, liveness tracking, slashing or bond consequences, and key-compromise procedures.
5. Add dashboards for source freshness, keeper lag, unresolved markets, disputes, liability by capability, operator participation, evidence replication, claims, and refunds.
6. Add alerts and public status for every condition that can delay user funds.
7. Perform source outage, false proposal, stale price, committee loss, RPC loss, storage loss, and key rotation drills.

Acceptance:

- Losing one server, RPC, observer, challenger, or committee member does not strand a market.
- No single Moros-controlled machine can decide an event result.
- Every incident has a tested runbook and an on-chain recovery path.

## Phase 5: security and limited mainnet

1. Complete an independent multi-party trusted setup and publish the transcript and artifact hashes.
2. Obtain an independent review covering contracts, circuits, browser proving, committee cryptography, resolver logic, factory, services, economics, and deployment configuration.
3. Resolve every critical and high finding and rerun regression and adversarial tests.
4. Reproduce all mainnet WASM and proving artifacts from tagged source.
5. Run a testnet soak for the exact release candidate and capability versions.
6. Deploy a price-only mainnet candidate with low per-market and total liability caps.
7. Verify a complete USDC lifecycle before enabling public creation.
8. Publish contract IDs, oracle IDs, operator set, limits, source rules, keeper status, audit status, and recovery instructions.
9. Enable only the exact price capabilities that pass every gate.
10. Add event templates to mainnet later, one capability at a time, after their independent event-oracle gates pass.

Mainnet acceptance:

- No mainnet dependency silently falls back to testnet.
- Real-USDC contracts match the reviewed build and deployment manifest.
- Claims and refunds remain permissionless and pull-based.
- Liability caps and halt controls are proven not to block withdrawals or refunds.
- Every enabled capability has live operators, monitoring, source rules, and a tested VOID path.

## Test plan

- Soroban unit tests for registry authorization, factory validation, capability versioning, limits, halts, immutable rules, resolver states, bond settlement, timeouts, claims, and refunds
- Property and boundary tests for price decimals, deviation, timestamps, liability, bond sizing, fees, and time calculations
- Service unit tests for every adapter schema, canonicalization, source priority, retry, correction, evidence hash, and signature
- Integration tests with recorded official-source fixtures and corrupted, delayed, missing, conflicting, and revised responses
- End-to-end testnet tests for every state transition and terminal recovery path
- Browser tests proving disabled categories cannot be signed or deployed
- Live read-only oracle verification in CI or a scheduled operational job, without making ordinary deterministic unit tests depend on the internet
- Reproducible build checks for WASM, circuits, proving keys, and deployment manifests

## Delivery order and commits

1. `fix: fail closed on unsupported oracle capabilities`
2. `feat: add onchain resolver capabilities and market factory`
3. `feat: add network scoped mainnet price oracles`
4. `feat: add event source adapters and evidence workers`
5. `feat: add event challenge and arbitration services`
6. `feat: fund oracle operations and scale resolver bonds`
7. `test: cover oracle failures and market recovery`
8. `docs: publish oracle operations and mainnet readiness`

Each commit must be independently testable. Do not merge the branch until the user verifies the UI, contracts, services, failure paths, and test evidence.

## Launch recommendation

Do not launch unrestricted real-USDC markets next week.

The first possible mainnet release is a low-limit, price-only beta using exact verified Reflector feeds after the Moros resolver, keeper, factory, trusted setup, end-to-end tests, and security gates are complete. Sports and other event categories remain disabled until the native Moros event oracle is operating independently and each exact template passes its own readiness gate.
