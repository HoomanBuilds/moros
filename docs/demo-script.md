# Moros testnet demo script

Use a market created by the current app. Do not use an older XLM test market to demonstrate the USDC flow.

Target: 2 minutes and 45 seconds.

## 1. Open

Show the landing page, then open the app.

Say:

"Prediction markets expose your side before the market settles. Moros encrypts each YES or NO position, proves it is valid in the browser, and settles only the aggregate of a batch on Stellar.

Any user can create a market. New markets use Circle USDC on Stellar testnet."

## 2. Create a market

Open /app/create.

Show a supported crypto, FX, or XAU price market with its asset, strike, and exact settlement time.

Say:

"A user creates the market from their own wallet. Crypto prices use the free Reflector CEX feed. FX and XAU use the free Reflector fiat feed. The form confirms the exact local settlement time and UTC before deployment.

Sports and other event categories remain unavailable until their observer, challenge, arbitration, and refund operations are running."

If you start a deployment, mention that each confirmed step is saved locally and can be resumed after a rejected signature or network interruption.

## 3. Place a private position

Open a current USDC market. Connect the wallet, choose YES or NO, choose an amount, and place the order.

Say:

"The browser creates a Poseidon commitment and a Groth16 proof over BLS12-381. The wallet deposits a public USDC privacy bucket, but the side and exact position amount are encrypted.

The committee verifies the proof before accepting the ciphertext. The secret, nullifier, and proof witness stay in this browser."

Show the OrderPlaced event on stellar.expert. Point out the commitment and public stake bucket. Do not claim that the stake bucket or funding wallet is hidden.

## 4. Show batching

Open the committee status and a completed batch transaction.

Say:

"The 2-of-3 committee adds encrypted orders and decrypts only the aggregate YES and NO totals. Each member proves its partial decryption and checks the exact commitments and nullifier hashes before signing.

Normal batches have four orders. A final batch can have two to four. Moros never decrypts a one-order batch because that would reveal its side. A lone pending order becomes fully refundable."

## 5. Resolve and claim

Show the Resolution tab, then the Portfolio.

Say:

"Price markets settle from the matching free Reflector testnet feed. Unsupported event markets cannot be created in this release.

Resolution does not automatically push money to wallets. Winners generate a redemption proof and pull their payout. Voided orders and orders that miss the final batch pull a full refund.

Moros charges 2% only on winning profit. Principal and refunds are never charged."

Show a claim or refund button. If showing a redemption transaction, state that the claim identifies the commitment and exact payout on-chain.

## 6. Close

Say:

"Moros combines user-created markets, Circle USDC, Soroban contracts, free testnet oracle resolution, threshold encrypted batching, and proof-bound claims.

Everything shown is testnet beta software. The contracts and circuits still need an independent trusted setup and external audit before mainnet."

## Short answers

- Who creates markets? Any connected user through /app/create.
- What is collateral? Circle USDC for every new market. XLM is used only for Stellar fees and reserve.
- What is public when betting? The wallet transaction, commitment, and collateral bucket.
- What stays encrypted during batching? The YES or NO side and exact position amount.
- What does the committee decrypt? Only a batch aggregate with at least two orders.
- What happens to one pending order? It becomes fully refundable after the final batch deadline.
- Are payouts automatic? No. Claims, refunds, resolution, and keeper actions require transactions.
- How does Moros earn? A fixed 2% fee on winning profit at redemption.
- What happens on a void? Full order stake refund and no platform fee.
- What resolves crypto prices? The free Reflector CEX feed on the current testnet beta.
- What resolves FX and XAU? The free Reflector fiat feed on the current testnet beta.
- Is Pyth active? No. Pyth Pro support remains disabled behind an explicit paid-mode switch.
- What resolves sports and other events? They are unavailable until the complete resolution operations are running and verified.
- What ZK circuits are current? order_commit, encrypt_order, and position_redeem.
- Are circuit files public? Yes. WASM, proving keys, and verification keys can be public. Private witnesses stay in the browser.

## Testnet references

- Circle USDC SAC: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
- Free price resolver: CAIHZHCNKHLCXGWOTH7T2L4S5YDNNGO6Q6MSDQ7HQ3A4IORN4NE6ZF5B
- Event resolver: CBOZK2JSSAOPXJWBSB6JZF5KLPMRQ52JCF4PADI7QUHQ3WS6KBKKBXW5
- Reflector CEX oracle: CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63
- Reflector fiat oracle: CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W
- Current deployment record: deployments/platform-hardening-testnet.json
