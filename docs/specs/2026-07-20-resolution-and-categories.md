# Resolution resilience and market categories specification

## Availability correction

This document describes resolver behavior, not current production availability. The [oracle capability specification](./2026-07-20-oracle-capability-gating.md) controls what may be created on each network. Event categories remain disabled until their observer, challenger, arbitration, timeout, and refund paths are operational. Rules and source URL validation alone do not make an event market supported.

## Market types

### Price markets

Examples include crypto, equities, commodities, FX, and economic index thresholds. These use numeric oracle data.

### Event markets

Examples include sports results, elections, launches, awards, and other objectively verifiable events. These use a bonded proposal and challenge flow tied to explicit rules and sources.

## Required market metadata

- Title
- Full resolution rules
- Category
- Resolution mode
- Primary source
- Backup sources
- Trading close time
- Resolution earliest time
- Void conditions
- Creator
- Rules hash stored on-chain

## Price resolution

The current testnet beta uses free Reflector mode. Reflector is a single on-chain oracle contract with its own multi-node consensus and exchange aggregation. It is not described as an independent multi-provider quorum. Paid Pyth Pro support remains disabled behind the explicit `pyth_pro` configuration switch.

- Read at least two configured independent sources when available.
- Normalize each source to a common decimal precision.
- Reject zero or negative prices.
- Reject prices older than the configured maximum age.
- Reject a source timestamp before the market's resolution time when exact expiry pricing is required.
- Use the median when a valid quorum exists.
- If valid sources disagree beyond the configured deviation, enter `Disputed` instead of choosing one source.
- If quorum is missing, enter `AwaitingOracle` and allow retry. Never silently use stale data.
- Reflector is the active free source. Pyth Pro is supported through its signed Stellar verifier path but is inactive in the current beta. Band and DIA adapters can be configured only after their live testnet deployments and feed support are verified.

## Event resolution

State flow: `Open -> Closed -> Proposed -> ChallengePeriod -> Resolved`, with `Disputed` and `Voided` branches.

- A proposer posts a USDC bond and an outcome with an evidence hash.
- A challenge window allows a counter-bond and alternate outcome.
- An undisputed proposal resolves after the window.
- A disputed proposal requires threshold approval by configured resolution signers.
- Signers cannot resolve before the resolution earliest time.
- A failed, canceled, ambiguous, or unverifiable event can be voided by threshold approval.
- A void market refunds each included order's full stake and charges no platform fee.
- UMA is not called directly because there is no documented Soroban deployment. The state machine follows the same optimistic pattern without pretending cross-chain data is natively verified.

The proposal, bond, challenge, and escalation model is based on the current [Polymarket resolution flow](https://docs.polymarket.com/concepts/resolution), which uses UMA's optimistic oracle. Moros implements the state machine natively on Soroban because no verified UMA deployment is available on Stellar testnet.

## Category rollout

- Crypto price
- Equities
- Commodities
- FX
- Economics
- Sports
- Politics
- Technology
- Culture
- Other

Only exact templates with an active network capability may be created. A configured feed, rules document, or source URL is insufficient without the enforced resolver and operator path.

## Acceptance tests

- Fresh agreeing prices resolve.
- Stale data, missing quorum, and excessive disagreement do not resolve.
- Decimal normalization cannot overflow and rounds consistently.
- An undisputed event proposal resolves only after the challenge window.
- A disputed event requires the configured threshold.
- A void outcome activates full refunds.
- Rules hashes cannot be changed after the first order.
