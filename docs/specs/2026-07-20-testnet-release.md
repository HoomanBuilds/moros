# Moros testnet release specification

## Release promise

Moros testnet must support the complete lifecycle for every market type visible to users. A wallet can create a supported market, place a private USDC position, follow that position in history, wait for batching and resolution, and recover the correct funds after the market reaches a terminal state.

Unsupported market types must remain visible only as unavailable categories with a clear explanation. They must not be deployable or registered.

The first public testnet release has no product or protocol version labels. The active contracts, circuits, services, database records, and UI use one canonical interface.

## Supported release scope

The active release supports price markets backed by the free Stellar testnet oracle configuration and USDC collateral on Stellar testnet.

Event markets, including sports, politics, weather, economics, equities, entertainment, technology, and general event questions, stay disabled until their observer, evidence, challenge, arbitration, monitoring, and recovery services pass the same release gates.

Paid oracle integrations remain implemented behind configuration switches but are not active in the free testnet deployment.

## Market lifecycle

| State | Orders | Resolution | User action |
| --- | --- | --- | --- |
| Open | Accepted | Not allowed | Place private USDC position |
| Closed | Rejected | Wait for final private batch | View pending settlement |
| Ready for resolution | Rejected | Free resolver keeper may resolve | View resolving state |
| Resolved YES or NO | Rejected | Final | Winner claims winnings and returned unused collateral. Loser recovers only remaining unused collateral and order budget. |
| Voided | Rejected | Final | Every eligible position claims a full refund |
| Resolution unavailable after timeout | Rejected | Resolver voids market | Every eligible position claims a full refund |

Resolution does not push funds automatically because Stellar contracts do not execute without a submitted transaction. Moros uses permissionless pull-based claims. The UI must make every available claim or refund obvious and retryable.

## One-sided markets

If a market reaches resolution with exposure on only one outcome, it must be voided. Included and pending positions receive full refunds through the normal void refund path. A one-sided market must never produce platform fees or winning rewards.

## Participation history

The connected wallet must have one durable history view containing every locally known and remotely backed-up private position.

Each history item must show:

- Market title and link
- Placement date and transaction link
- Selected side
- Private position size
- Public USDC collateral bucket
- Batch state
- Market state and final outcome
- Result as active, won, lost, voided, refunded, claimed, or action required
- Estimated winnings, remaining collateral recovery, or full refund
- Platform fee when applicable
- The correct action button only when an action is available

History filters must include all, active, action required, and settled. A resolved losing position must never display Claim winnings. If it has recoverable collateral, it displays Recover remaining USDC. If its recoverable amount is zero, it displays Lost with no claim action.

## Private position durability

The local browser remains the immediate source for private position notes. Moros also provides an encrypted wallet-owned backup in Supabase.

The private payload includes side, amount, stake bucket, secret, and nullifier. It is encrypted in the browser with a key derived from a deterministic, domain-separated wallet signature. The signature and encryption key never leave the browser. Supabase stores only ciphertext, an initialization vector, public market identifiers, and transaction metadata.

Row-level security allows only the authenticated wallet to read, insert, update, or delete its position backups. A new browser can authenticate, sign the same backup message, decrypt the records, and restore claim capability.

Local export and import remain available as a second recovery path. Exported data must be validated before import, deduplicated by commitment, and scoped to the connected wallet.

## Claim calculations

For an order amount `amount`, public stake bucket `stake`, side clearing price `price`, and fee rate `fee rate`:

- Unused stake is `stake - amount`
- Unspent order budget is `amount * (1 - price)`
- A winning position also receives `amount`
- Platform fee applies only to winning profit
- A losing position pays no platform fee and earns no winnings

The browser estimate is informative. The proof and contract remain authoritative.

## Testnet operating requirements

- Only Stellar testnet is selectable in the release deployment
- Every listed market uses Stellar USDC collateral
- The active free resolver is configured on every listed market
- The resolution keeper runs continuously and is monitored
- The committee reports the expected threshold, batch size, active pools, and readiness
- New pools are validated on-chain before committee registration
- Closed, resolved, voided, and expired markets reject new orders in both the UI and contracts
- The UI never falls back from an unknown market to a seed pool
- Circuit WASM and proving keys are publicly downloadable and their expected hashes are verified by the application or release check
- Comments require wallet authentication and support validated image uploads
- All unit, contract, service, browser, build, lint, and live lifecycle tests pass

## Release acceptance matrix

| Scenario | Expected result |
| --- | --- |
| Create supported price market | USDC market deploys, resolver is configured, metadata is registered |
| Create unsupported event market | Deployment is blocked before wallet transaction |
| Place YES and NO positions | Both appear immediately in wallet history and are encrypted in committee submission |
| Committee unavailable | No on-chain order is placed |
| Proof submission fails after placement | History shows recovery-required state and supports retry |
| Market expires | New orders are blocked and final batch window is shown |
| Resolver succeeds | Outcome becomes final and correct user actions appear |
| Oracle stays unavailable | Resolver timeout voids the market and refunds become available |
| Only one outcome has exposure | Market becomes void and all positions receive full refunds |
| Winning position | Claim winnings action appears and fee is charged only on profit |
| Losing position with remainder | Lost result appears with Recover remaining USDC |
| Losing position without remainder | Lost result appears with no action |
| Voided pending or included position | Claim full refund appears |
| Completed claim or refund | History moves to settled and transaction link remains available |
| New browser recovery | Wallet restores and decrypts remote position history |
| Unknown or older registry entry | Entry is hidden from active markets and never uses another pool as fallback |

## Release evidence

The release is ready only when the repository contains test output and a testnet run record with contract IDs, transaction hashes, market outcomes, committee status, resolver status, claim or refund results, and the tested web deployment URL. Secrets and private position notes must never be included in the record.
