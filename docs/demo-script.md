# Moros testnet demo script

Use a market created through the canonical shared-vault deployment.

Target: 2 minutes and 45 seconds.

## 1. Open

Show the landing page, then open the app.

Say:

"Prediction markets expose a user's side and position size before settlement. Moros keeps both encrypted, validates each action with a zero-knowledge proof, and clears only valid aggregates on Stellar.

Any user can create a market. Every active market uses Circle USDC on Stellar testnet."

## 2. Create a market

Open `/app/create`.

Show a supported crypto, FX, or XAU price market with its asset, strike, liquidity target, and exact settlement time.

Say:

"A user proposes the market from their own wallet without supplying its liquidity. The pooled LP vault allocates capital automatically when its risk and utilization rules allow it. Crypto prices use the free Reflector CEX feed. FX and XAU use the free Reflector fiat feed.

Sports and other event categories remain unavailable until their observer, challenge, arbitration, and refund operations are running."

If you start a proposal, mention that each confirmed step is saved under the current factory and can be resumed after a rejected signature or network interruption.

## 3. Shield USDC and place a private position

Open the Portfolio, connect the wallet, and shield USDC into the reusable private balance. Then open an active market, choose YES or NO, enter an integer quantity, and place the order.

Say:

"Shielding is a public Stellar boundary, so the wallet, USDC amount, vault, and transaction are visible. Private bets then spend shielded notes through BN254 Groth16 proofs and a relayer, without another wallet transaction. The side and exact quantity remain encrypted.

The service and contract verify the proof before accepting the ciphertext. Spending keys, note plaintext, and proof witnesses stay in this browser."

Show the private order event on stellar.expert. Point out that the target market, timing, commitment, nullifier, and relayer transaction remain public. Do not claim network-level anonymity.

## 4. Show batch clearing

Open the private service health view and a completed batch transaction.

Say:

"The testnet coordinator fills an eight-order batch and decrypts only the aggregate YES and NO quantities. Every valid batch has at least two orders on each side and clears atomically at one price.

No user receives the advantage of trading against a partially updated price. An order that cannot enter a valid final batch becomes privately refundable."

State clearly that the current coordinator uses one VM and one combined committee secret. Independent threshold members are required before mainnet.

## 5. Resolve and claim

Show a resolved market and the Portfolio.

Say:

"Price markets settle from the matching free Reflector testnet feed. Unsupported event markets cannot be created in this release.

Resolution does not automatically push money to wallets. Winners generate a proof-bound claim into their private balance. Voided orders and orders that miss the final batch pull a full private refund.

The final transfer from private balance to a public Stellar wallet is a separate visible withdrawal boundary."

Show only the action available for that record. Losing positions with no recovery must not show a claim button.

## 6. Close

Say:

"Moros combines user-created markets, Circle USDC, Soroban contracts, free testnet oracle resolution, encrypted batch clearing, pooled liquidity, and proof-bound claims.

Everything shown is testnet beta software. The contracts and circuits still need an independent trusted setup and external audit before mainnet."

## Short answers

- Who creates markets? Any connected user through `/app/create`.
- Who funds markets? Permissionless LPs deposit into one pooled private USDC vault, which allocates by policy.
- What is collateral? Circle USDC. XLM is used only for Stellar fees and account reserve.
- What is public when shielding? The wallet, USDC amount, vault, and transaction.
- What is public when betting? The market, timing, commitment, nullifier, and relayer transaction.
- What stays encrypted during batching? The YES or NO side and exact position quantity.
- What does the coordinator decrypt? Only the aggregate of an eight-order batch with at least two orders per side.
- What happens to an order that cannot form a valid batch? It becomes fully refundable after the final batch deadline.
- Are payouts automatic? No. Claims and refunds are permissionless pull actions. The keeper submits resolution transactions.
- How does Moros earn? Each market has an immutable fee capped by deployment policy. The current app proposes 2%, split between LPs and the protocol.
- What happens on a void? The protocol returns the full valid order budget without a platform fee.
- What resolves crypto prices? The free Reflector CEX feed.
- What resolves FX and XAU? The free Reflector fiat feed.
- Is Pyth active? No. Pyth Pro support remains disabled behind an explicit paid-mode switch.
- What resolves sports and other events? They are unavailable until the complete resolution operations are running and verified.
- What ZK system is current? Fifteen BN254 Groth16 circuits cover private balance, pooled liquidity, orders, batches, claims, refunds, and withdrawals.
- Are circuit files public? Yes. WASM, proving keys, and verification keys can be public. Private witnesses stay in the browser.

## Testnet references

- Circle USDC SAC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Reflector CEX oracle: `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63`
- Reflector fiat oracle: `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W`
- Current verifier, resolver, shared vault, pooled liquidity vault, and factory IDs: `deployments/private-testnet.json`
