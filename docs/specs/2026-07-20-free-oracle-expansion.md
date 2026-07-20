# Free oracle expansion specification

## Verified provider status

| Provider | Stellar path | Current testnet status | Cost status | Moros use |
| --- | --- | --- | --- | --- |
| Reflector CEX | Native SEP-40 contract | Live | Free public reads | Active crypto price settlement |
| Reflector fiat | Native SEP-40 contract | Live | Free public reads | Active FX and XAU settlement |
| Pyth Pro | Native Soroban signature verifier | Live | Subscription with a temporary free trial | Disabled behind `pyth_pro` |
| Pyth free proxy | Off-chain unsigned JSON | Live beta | Free beta | Never used for settlement |
| Pyth Core | Pull oracle contracts | No documented Stellar contract | Not applicable | Disabled |
| Band | Stellar reference contract | Official testnet address is not live | No active testnet feed | Disabled |
| DIA | Stellar oracle contract | Official testnet address is not live | No active testnet feed | Disabled |

Pyth Pro supports more than 500 feeds across crypto, equities, FX, commodities, metals, and other financial data. Its Stellar verifier accepts signed `leEcdsa` payloads. The unauthenticated beta proxy currently returns latest unsigned JSON only. It cannot prove a historical price at market expiry and must not move funds.

## Active free price markets

### Crypto price

The live Reflector CEX contract provides BTC, ETH, USDT, XRP, SOL, USDC, ADA, AVAX, DOT, MATIC, LINK, DAI, ATOM, XLM, UNI, and EURC against USD.

### FX

The live Reflector fiat contract provides EUR, GBP, CHF, CAD, MXN, ARS, BRL, and THB against USD.

### Gold price

The live Reflector fiat contract provides XAU against USD.

Each resolver source must report `Other(USD)` as its base. A source with another base is ignored. Prices must be positive, within the expiry freshness window, and available in retained history. Missing or invalid data leaves resolution pending. After the immutable resolution timeout, anyone can VOID the market for full refunds.

The two Reflector contracts expand asset coverage. They do not count as two independent provider families. Free mode therefore uses quorum one for the feed that covers the selected asset. Paid mode can require Pyth Pro and Reflector agreement after a valid Pyth subscription and resolver deployment are configured.

## Event markets

Equities, commodities without an active free Stellar feed, sports, economics, weather, politics, technology, entertainment, and custom events use the native optimistic event resolver.

Every new event market records:

- One objective YES or NO question
- One primary official source URL
- At least one distinct backup source URL
- Exact YES rules, including the measurement, cutoff, and time zone
- Exact VOID rules for cancellation, postponement, missing data, revisions, or ambiguity
- An immutable hash covering the complete rule set

Free public APIs and official result pages may help a proposer collect evidence. They do not directly settle funds. A proposer posts a USDC bond with an outcome and evidence URL. A conflicting bonded result starts threshold committee arbitration. If no quorum forms before the deadline, anyone can VOID the market and return both bonds. Unchallenged results finalize only after the challenge window.

## Source guidance by category

| Category | Preferred primary source | Backup evidence |
| --- | --- | --- |
| Equities | Official exchange or issuer filing | Regulator filing or another recognized exchange record |
| Commodities | Named benchmark administrator or exchange | Regulator or official market bulletin |
| Sports | Official league, federation, or event organizer | Official team or tournament result page |
| Economics | Government statistical agency or central bank | Another official publication carrying the same release |
| Weather | Named station and public meteorological authority | Independent public weather archive for the same station and interval |
| Politics | Official election authority or legislative record | Court, gazette, or another official government record |
| Technology | Official project, standards body, or public repository release | Independent release registry or signed announcement |
| Entertainment | Official award body, broadcaster, or event organizer | Official nominee or winner publication |

The market rules decide which source controls if sources differ. A disagreement without an explicit priority rule is ambiguous and resolves VOID.

## User interface

- Creation shows only assets with a live active resolver path.
- Price charts read Reflector on-chain history first.
- Event category templates explain the expected official source and edge cases.
- Backup source URLs are validated, deduplicated, stored, displayed, and covered by the on-chain rules hash.
- Price markets identify the active free provider and do not claim independent provider quorum.
- The Pyth paid switch remains explicit and disabled in the current beta.

## Acceptance

- A USD-base Reflector source resolves a fresh supported market.
- A non-USD SEP-40 source is rejected.
- Crypto, FX, and XAU lists exactly match verified live Reflector assets.
- A price preview can be read from the same Reflector contract used for settlement.
- Event rules cannot be verified if a covered source or rule is modified.
- New event markets require a distinct valid backup source.
- Older version 1 event rules remain verifiable.
- Unsupported or unavailable providers cannot be selected accidentally.
- All contract, service, web unit, type, build, and browser tests pass.

## References

- [Stellar oracle providers](https://developers.stellar.org/docs/data/oracles/oracle-providers)
- [Reflector documentation](https://reflector.network/docs)
- [Reflector SEP-40 interface](https://reflector.network/docs/interface)
- [Pyth Pro Stellar integration](https://docs.pyth.network/price-feeds/pro/integrate-as-consumer/stellar)
- [Pyth Pro proxy beta](https://docs.pyth.network/price-feeds/pro/api/proxy)
- [Pyth Terminal and free trial](https://docs.pyth.network/price-feeds/pro/pyth-terminal)
- [Pyth Pro price feed IDs](https://docs.pyth.network/price-feeds/pro/price-feed-ids)
- [Pyth Core contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses)
- [Band Stellar reference contracts](https://github.com/bandprotocol/band-std-reference-contracts-soroban)
- [DIA Stellar integration](https://www.diadata.org/docs/guides/chain-specific-guide/stellar)
