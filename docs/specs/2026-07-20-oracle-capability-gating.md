# Oracle capability gating and market resolution specification

## Decision

Moros must never accept funds for a market unless that exact market template has an operational resolver on the selected Stellar network.

A category label is not an oracle capability. Sports, weather, economics, politics, equities, commodities, technology, entertainment, and custom markets each require a specific template, source adapter, operator set, dispute path, timeout, and refund path before creation is enabled.

The initial mainnet scope must be price markets backed by verified Reflector mainnet feeds. Event-market creation remains disabled until the Moros event oracle services and independent operators pass the readiness gates in this specification.

## Current repository finding

The repository has two useful on-chain foundations, but it does not yet have a production event oracle.

- The price resolver reads SEP-40 sources, validates freshness, supports source disagreement handling, and can void stale markets.
- The event resolver implements a USDC bond, challenge period, committee arbitration, and timeout to VOID.
- The deployed testnet event resolver uses a flat 10 USDC bond, a one-hour challenge period, and a two-of-three committee.
- The event resolver hashes the evidence reference string. It cannot fetch or verify the referenced page content.
- The price keeper ignores event markets.
- No service fetches sports, weather, political, economic, entertainment, or other event results.
- No service automatically challenges a false event result.
- No service submits event committee votes.
- The three current committee members run from one deployment path and are not independent operators.
- No live event market has completed creation, betting, challenge or resolution, and USDC claim or refund as one end-to-end test.
- Mainnet has no Moros contract deployment record in this repository.
- Contracts and circuits are unaudited, and the proving keys use a development trusted setup.

The event resolver contract is therefore an on-chain settlement component, not a complete production oracle.

## Verified Stellar oracle status

This table records documentation and live read checks performed on July 20, 2026.

| Provider | Stellar mainnet status | Verified coverage | Moros decision |
| --- | --- | --- | --- |
| Reflector external CEX and DEX | Live public SEP-40 contract | BTC, ETH, USDT, XRP, SOL, USDC, ADA, AVAX, DOT, MATIC, LINK, DAI, ATOM, XLM, UNI, EURC | Active free price provider after a network-specific resolver deployment |
| Reflector fiat | Live public SEP-40 contract | EUR, GBP, CAD, BRL, JPY, CNY, MXN, KRW, TRY, ARS, PEN, VES, CLP, CRC, CDF, COP, HKD, INR, NGN, PHP, RUB, ZAR, XAU, KES | Active free FX and gold provider after a network-specific resolver deployment |
| Reflector Stellar DEX | Live public SEP-40 contract | Stellar asset contract pairs quoted in mainnet USDC | Optional additional market-data source after asset identity mapping is implemented |
| Band | Live documented mainnet reference contract | Live reads succeeded for XLM and USDC in the tested set. BTC, ETH, EUR, and XAU reads failed | Add a separate adapter and use only for individually verified pairs. Do not claim broad coverage |
| Pyth Pro | Official Stellar contract is listed for testnet only | Broad signed financial feeds on supported deployments | Keep the existing paid switch disabled on mainnet until Pyth publishes and Moros verifies a mainnet contract |
| DIA | Official Stellar documentation lists a testnet contract only | BTC, USDC, and DIA on the documented testnet contract | Keep disabled on mainnet. Preserve a future custom-provider switch |
| UMA | No verified native Soroban deployment was found | None on Stellar | Do not depend on UMA. Moros uses a native optimistic event resolver |

Reflector mainnet was read directly through Stellar RPC. Both the external market and fiat contracts returned a five-minute resolution and one-day history retention. Reflector is a properly operated oracle provider with its own distributed node consensus, but its contracts remain one provider family. Two Reflector contracts do not become two independent providers.

An external oracle being live does not make Moros mainnet-ready. Moros still needs network-specific resolver deployment, keeper operation, end-to-end testing, independent infrastructure, trusted setup, and security review.

## Configuration defects that must be fixed

- `web/lib/markets/deploy-constants.ts` defaults to testnet Reflector and resolver contract IDs even when the selected network is mainnet.
- The current free asset lists are testnet lists reused by mainnet.
- Reflector mainnet fiat coverage differs from testnet. For example, the current UI can offer CHF and THB even though they were absent from the verified mainnet fiat list.
- The current mainnet network configuration has no seed market, pool, price resolver, event resolver, committee, or treasury deployment manifest.
- The create flow permits every event category when one generic event resolver ID and a rules hash exist. It does not require a working source adapter or event operator coverage.
- The browser deploys market and pool contracts directly. UI checks alone cannot prevent an unsupported deployment.

All mainnet deployment IDs must be mandatory and network-scoped. A mainnet build must fail closed if any required deployment is missing or belongs to another network.

## Capability model

Moros must publish a versioned capability record for every creatable template.

Each record contains:

- Stellar network ID
- Capability ID and version
- Category used for discovery
- Exact market template ID
- Resolver kind and resolver contract ID
- Approved market and pool WASM hashes
- Collateral SAC and decimals
- Supported asset, league, jurisdiction, station, series, or event scope
- Source adapter IDs and versions
- Primary and backup source rules
- Oracle operator set and threshold
- Challenge and arbitration periods
- Resolution timeout and VOID behavior
- Maximum market subsidy, user stake, and total liability
- Minimum protocol version
- Status of `test_only`, `active`, `halt_new_markets`, or `disabled`
- Last successful health check and tested ledger

The contract-controlled fields must live in an on-chain capability registry. A public API may cache and enrich them, but it must not be the authority.

## Enforced creation path

Moros must replace direct browser deployment with a market factory.

1. The user selects an active template exposed by the on-chain capability registry.
2. The application collects only fields allowed by that template.
3. The factory checks the capability, network, collateral, resolver, WASM hashes, limits, and source parameters.
4. The factory deploys the market and pool and records the capability version in both.
5. The resolver registers the immutable rules hash and template data.
6. The protocol registry accepts only factory-created deployments.
7. The committee, keeper, indexer, and application refuse unknown or disabled deployments.

The user remains the market creator and funds the required subsidy. The factory is a safety boundary, not an admin-only market creator.

If a user proposes an unsupported event, the UI may save it as an unfunded draft or coverage request. It must not deploy a funded market until a compatible template and operator set are active.

## Runtime safety

Capability checks also apply after creation.

- A disabled capability prevents new markets.
- A capability health failure pauses new orders for affected open markets.
- A pause cannot block claims, refunds, challenge submissions, committee votes, or timeout-to-VOID.
- Existing rules and source priority cannot change after the first order.
- Existing markets keep their recorded capability version.
- Operator rotation requires a delayed, on-chain process and cannot rewrite an active dispute.
- Every market has a permissionless timeout path to VOID and pull-based refunds.

## Supported template tiers

### Tier P1: automated price threshold

Example: BTC is at or above a stated USD price at a stated expiry.

Requirements:

- Exact live feed on the selected network
- Positive price and correct base asset
- Timestamp at or after the market expiry within the permitted window
- Historical retention compatible with keeper timing
- Immutable resolution timeout
- Permissionless resolve and timeout-to-VOID calls

This is the only suitable initial mainnet tier, subject to the security and deployment gates.

### Tier P2: independent price corroboration

This tier requires at least two independent provider families and a defined deviation limit. Band can become a second source only for exact pairs that are live and after its different contract interface is integrated. Pyth Pro and DIA remain inactive unless their mainnet Stellar deployments and commercial access are verified.

### Tier E1: structured events

Structured templates expose only deterministic inputs and fixed edge-case rules.

| Template | Required scope | Required rule fields |
| --- | --- | --- |
| Sports match winner | One supported league or federation adapter and official event ID | Regulation and overtime treatment, postponement, abandonment, forfeit, correction cutoff |
| Weather observation threshold | One supported authority, station ID, metric, units, and interval | Observation type, quality-control status, missing data, station outage, correction cutoff |
| Economic release | One supported statistical authority and series ID | Observation period, first release or revised value, seasonal adjustment, publication cutoff |
| Election winner | One supported election authority and contest ID | Certification level, recounts, court changes, withdrawal, finality cutoff |
| Award or technology release | One supported official publisher and event ID | Controlling publication, delay, cancellation, retraction, correction cutoff |

A category can contain many unsupported events. Only the exact scopes registered in capabilities are directly creatable.

### Tier E2: custom binary event

Custom events use bonded optimistic resolution and manual evidence review. They require stronger bonds, longer challenge periods, independent operators, and a pre-creation coverage check. This tier remains disabled for the initial mainnet release.

## Moros event oracle architecture

### Source registry

Each adapter version defines:

- Allowed official domains and endpoints
- Request parameters and authentication mode
- Response schema and canonical field mapping
- Expected publication time and time zone
- Primary and backup source priority
- Outcome computation
- Cancellation, postponement, ambiguity, revision, and source-outage behavior
- Terms and data-usage review status

The adapter version and all rule inputs are included in the market rules hash.

### Observation workers

At least three independently operated workers observe each enabled event template.

Each worker:

- Fetches the configured source
- Validates the response schema and publication timestamp
- Canonicalizes the response
- Stores the raw response and relevant headers in durable public evidence storage
- Calculates a content hash
- Signs the normalized observation with the adapter version and retrieval time
- Repeats observations during the correction window

Three workers reading one source protect against one failed Moros server. They do not make the underlying source independent. Source independence comes from the fixed primary and backup sources and the dispute rules.

### Evidence bundle

The on-chain proposal must commit to the content hash of an evidence bundle, not only a URL string. The bundle includes raw source responses, canonical observations, adapter version, timestamps, source priority, and operator signatures.

The contract cannot fetch web content. Off-chain challengers and committee members verify the bundle, while the on-chain hash prevents substitution.

### Proposal and challenge

- Matching worker observations create a candidate result.
- Any account may post the candidate with the required USDC bond.
- Independent watcher processes compare every proposal with their own observations.
- A mismatch, invalid source, stale publication, changed rules, or ambiguous result triggers a counter-bonded challenge.
- Correct challengers receive the losing bond after arbitration.
- An undisputed proposal remains pending for the full template-specific challenge period.

### Arbitration

Mainnet event resolution requires at least five independently controlled members with a three-member threshold. Higher-value templates may require seven members with a five-member threshold.

Members must run on separate infrastructure and review the immutable rules plus evidence bundle before signing YES, NO, or VOID. Privacy committee membership and event arbitration membership should not be identical by default.

### Finalization and liveness

- Anyone may finalize an undisputed proposal after the challenge period.
- A small fixed keeper reward is paid from the market resolution budget.
- A disputed result finalizes only when the configured threshold agrees.
- If no proposal arrives by the resolution timeout, anyone may VOID the market.
- If a dispute fails to reach quorum by the arbitration timeout, anyone may VOID the market.
- VOID returns both honest-but-unresolved bonds and enables full pull refunds with no platform fee.
- No user depends on a Moros server to claim or refund after a terminal on-chain result.

## Resolution state machine

| Current state | Valid next state | Caller | Incentive | Failure path |
| --- | --- | --- | --- | --- |
| Draft | Open | User through factory | Create the market | Reject unsupported capability |
| Open | Closed | Permissionless keeper or any account after close time | Keeper reward | Timestamp makes late orders impossible even if no caller acts |
| Closed | Awaiting observation | Any account | Advance settlement | Market remains closed |
| Awaiting observation | Proposed | Bonded proposer | Resolution reward and returned bond | Timeout permits VOID |
| Proposed | Disputed | Bonded challenger | Winning bond reward | Challenge window eventually closes |
| Proposed | Resolved | Any finalizer after challenge period | Keeper reward | Invalid finalization reverts |
| Disputed | Resolved or Voided | Threshold arbitration members | Operator compensation and reputation | Arbitration timeout permits VOID |
| Awaiting observation or Disputed | Voided | Any finalizer after timeout | Keeper reward | Users retain pull refunds |
| Resolved | Claims remain available | Winning user | Receive USDC payout | Replay protection rejects double claim |
| Voided | Refunds remain available | Any affected user | Recover USDC stake | Replay protection rejects double refund |

Every transition has a caller, a reason to call, and a terminal fallback. Nothing is described as automatic unless a deployed and monitored service actually submits the transaction.

## Oracle economics

The current flat 10 USDC bond is not suitable for unrestricted mainnet markets.

- Bond size must scale with the market's maximum resolvable liability and template risk.
- Every market funds a resolution budget at creation.
- Correct proposer and finalizer rewards come from the resolution budget, not user principal.
- A losing disputed party forfeits its bond to the correct counterparty and operator budget according to fixed rules.
- A source outage or unresolved honest dispute returns bonds and resolves VOID.
- Maximum liability is capped per capability, resolver version, and operator set.
- Early mainnet limits must be low and increase only after measured successful settlements.
- Platform trading or winning-profit fees remain separate from oracle fees and never reduce VOID refunds.

Provider reads may be free, but mainnet resolution is not costless. Stellar transaction fees, storage, monitoring, servers, and independent operator work still require funding.

## Market availability matrix

| Market scope | External mainnet data now | Moros mainnet creation now | Required next work |
| --- | --- | --- | --- |
| Supported crypto price thresholds | Reflector live | Blocked | Mainnet resolver, factory, keeper, full USDC lifecycle, security gates |
| Supported FX thresholds | Reflector live for exact verified list | Blocked | Network-specific asset list and the same launch gates |
| XAU price thresholds | Reflector live | Blocked | Same price launch gates |
| XLM price corroboration | Reflector and Band data are live | Blocked | Band adapter, decimal and freshness tests, independent-source resolver deployment |
| Equities | No verified active free Stellar mainnet feed in current integration | Disabled | Verified provider or native licensed adapter |
| Commodities other than XAU | No verified active free Stellar mainnet feed in current integration | Disabled | Verified provider or native licensed adapter |
| Sports | No general Stellar event oracle | Disabled | League-specific adapter or independently operated manual oracle |
| Economics | Official public APIs exist outside Stellar | Disabled | Series-specific adapters, workers, evidence, challenge automation |
| Weather | Official public APIs exist for limited jurisdictions | Disabled | Station-specific adapters, workers, quality and outage rules |
| Politics | Official sources differ by jurisdiction | Disabled | Contest-specific adapter and certification rules |
| Technology and entertainment | Official sources differ per event | Disabled | Publisher-specific adapters and correction rules |
| Custom events | No production operator network | Disabled | Independent arbitration network and pre-creation coverage process |

## Mainnet readiness gates

No real-USDC mainnet market opens until all applicable gates pass.

- Independent security review of market, pool, resolvers, factory, registry, services, and circuits
- Independent multi-party trusted setup with published transcript and reproducible artifacts
- Mainnet-specific deployment manifest with no testnet fallback IDs
- Verified Circle USDC SAC and all resolver dependencies on mainnet
- At least five independently controlled privacy or arbitration operators where applicable
- Full USDC lifecycle evidence for creation, one-sided betting, final short batch, price resolution, winning claim, stale-oracle VOID, pending-order refund, and replay rejection
- Fault tests for RPC outage, source outage, stale data, disagreement, malicious proposal, committee member loss, keeper loss, and evidence-storage loss
- Testnet soak for every enabled capability version
- Monitoring, alerts, backups, key rotation, operator runbooks, and public status page
- Low initial liability limits and a pause that affects only new markets or new orders
- Public disclosure that payouts and refunds are user-claimed, not pushed automatically

## Mainnet launch decision

Moros does not currently have a production-ready oracle system for unrestricted mainnet markets.

Reflector provides properly made mainnet price oracles. That allows a future limited price-only mainnet beta after Moros completes its own deployment and security gates. It does not make sports, politics, weather, economics, entertainment, equities, commodities, or custom markets ready.

An unrestricted next-week mainnet launch would expose real USDC through unaudited contracts, development proving keys, testnet-default resolver configuration, and an incomplete event backend. It must not proceed in that form.

## References

- [Stellar oracle providers](https://developers.stellar.org/docs/data/oracles/oracle-providers)
- [Reflector documentation](https://reflector.network/docs)
- [Reflector SEP-40 interface](https://reflector.network/docs/interface)
- [Band Soroban reference contract](https://github.com/bandprotocol/band-std-reference-contracts-soroban)
- [Pyth Pro contract addresses](https://docs.pyth.network/price-feeds/pro/contract-addresses)
- [DIA Stellar integration](https://www.diadata.org/docs/guides/chain-specific-guide/stellar)
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- [Bureau of Labor Statistics API](https://www.bls.gov/developers/)
- [World Bank Indicators API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [FRED API](https://fred.stlouisfed.org/docs/api/fred/)
