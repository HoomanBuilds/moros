<p align="center">
  <img src="web/public/logo.png" alt="Moros logo" width="120" />
</p>

<h1 align="center">Moros</h1>

<p align="center">
  <b>Private binary prediction markets on Stellar.</b>
</p>

Moros lets any connected user create a market, place an encrypted YES or NO position, and claim a proof-bound payout. New markets use Circle USDC on Stellar. XLM is required only for Stellar fees and reserves. Legacy testnet markets that used XLM remain readable and are labeled with their actual collateral.

Moros is currently an unaudited testnet beta. Do not use it with real funds.

## Current product

- User-created oracle-backed price markets
- Circle USDC collateral for every new market
- On-chain LMSR pricing and creator-funded liquidity
- Browser-generated Groth16 proofs over BLS12-381
- Encrypted order sides with 2-of-3 threshold batch settlement
- Proof-based redemption and refunds
- A 2% platform fee on winning profit only
- Wallet-authenticated comments with optional images
- Free Reflector price resolution for the current testnet beta
- Optional Pyth Pro support kept behind an explicit operator switch

## Market lifecycle

### 1. Create

Any connected user can create a market from /app/create.

For a price market, the creator chooses a supported asset, strike, close time, and resolution time. The market uses the active price resolver.

The event resolver contract supports rules for future sports, politics, and other objective markets:

- A precise binary question
- An official resolution source
- Exact YES conditions
- Cancellation, ambiguity, and void rules

The canonical rules are hashed in the browser and registered on-chain. Event creation is currently disabled because the independent observer, challenge, and arbitration operations are not yet running. The UI does not advertise a market type that the backend cannot resolve.

Creation deploys and links an LMSR market and a shielded pool through several wallet transactions. The current beta uses 13.8629437 testnet USDC for the fully funded LMSR worst-case subsidy, which fits within one 20 USDC Circle faucet request. A market is listed only after its contracts, resolver, committee, fee, and liquidity setup complete.

### 2. Place a private position

The browser creates an order commitment and proves that its encrypted side is valid. The proof is generated locally with public artifacts from web/public/zk.

The user deposits one of the supported USDC privacy buckets:

- 1
- 5
- 10
- 25
- 50
- 100
- 250
- 500
- 1,000 USDC

The public transfer reveals the bucket, but not the YES or NO side. The private secret and nullifier stay in the browser.

The committee service verifies the encryption proof before accepting the ciphertext. The contract also records the exact commitment, stake, and pending status.

### 3. Batch

Normal batches contain four orders. The committee homomorphically adds ciphertexts and decrypts only the aggregate YES and NO totals. Each member proves its partial decryption, and a 2-of-3 signer threshold authorizes the on-chain update.

After market close, a final batch may contain two to four orders. A batch of one is rejected because its aggregate would reveal the order side. A lone pending order becomes fully refundable after the final batch deadline.

Once a shielded pool is linked, direct market trading is permanently disabled. This prevents outside trades from changing the clearing price and breaking shielded-pool solvency.

### 4. Resolve

Price markets use the free testnet Reflector resolver by default. Reflector is one on-chain oracle contract backed by its own multi-node aggregation. Moros does not claim that this is an independent multi-provider quorum.

The resolver checks the historical price at the market expiry, freshness, decimals, confidence, and configured deviation limits. If usable data remains unavailable through the resolution timeout, anyone may void the market.

When event operations are enabled, the event resolver uses an optimistic bonded flow:

1. A proposer posts 10 testnet USDC with an outcome and public evidence.
2. Another user may challenge during the one-hour beta window by posting the same bond and a different outcome.
3. An undisputed proposal can be finalized after the window.
4. A dispute is decided by independent committee votes with a 2-of-3 threshold.
5. An unresolved dispute eventually becomes permissionlessly voidable and both bonds are returned.

The event resolver can select YES, NO, or VOID.

### 5. Claim or refund

Payouts are pull-based. Resolution does not automatically send funds to every wallet.

- A winning user generates a redemption proof and claims the payout.
- The pool claims its winning LMSR shares once before paying users.
- A losing position cannot redeem a winning payout.
- A void market returns the full order stake with no platform fee.
- A pending order that missed the final batch can be fully refunded after the deadline.
- Every order, refund, and redemption is bound to state and rejects replay.

If all included positions are on only one side, resolution voids the market and every included order receives its full stake back. This prevents a one-sided testnet market from producing misleading rewards. A single pending order is also refundable if it cannot join a private batch before the deadline.

## Fees

Moros charges 200 basis points, or 2%, on winning profit only.

    fee = max(payout - stake, 0) * 2%

Returned principal, losing-order refunds, and void refunds are not charged. The treasury and fee rate are immutable for each pool. The contract caps deployment-time fees at 10%.

Moros does not take a percentage of the whole market pool. Pool-wide fees could seize creator liquidity or unclaimed user collateral and make solvency harder to reason about.

## Oracle modes

The current beta must run in free mode:

    ORACLE_MODE=free
    NEXT_PUBLIC_ORACLE_MODE=free

The paid integration remains available for a future operator:

    ORACLE_MODE=pyth_pro
    NEXT_PUBLIC_ORACLE_MODE=pyth_pro
    PYTH_PRO_RESOLVER_ID=<deployed paid resolver>
    NEXT_PUBLIC_PYTH_PRO_PRICE_RESOLVER_ID=<deployed paid resolver>
    PYTH_ACCESS_TOKEN=<paid access token>

Paid mode has no default resolver or token. It cannot activate accidentally through the old generic resolver configuration.

Public Band and DIA addresses listed in older documentation were not live after the latest Stellar testnet reset, so they are not configured as fake backups.

## Architecture

### Contracts

- contracts/lmsr-market: funded binary LMSR, lifecycle, batch settlement, resolution, and share claims
- contracts/shielded-pool: USDC custody, commitments, order status, committee checks, refunds, position redemption, and fees
- contracts/resolver: free Reflector price resolution, optional verified Pyth payloads, and stale-market voiding
- contracts/event-resolver: bonded event proposals, challenges, committee votes, evidence, finalization, and timeout voiding

### Circuits

- order_commit: derives the order commitment
- encrypt_order: proves commitment membership and binds the encrypted YES and NO amounts to the committee key
- position_redeem: proves order ownership, outcome, clearing-price payout, stake, recipient, nullifier, and exact fee

Circuits compile to Groth16 over BLS12-381. Browser WASM and proving keys are intentionally public. Proof soundness comes from private witness values and the on-chain verification key, not from hiding proving artifacts.

The current setup uses a development trusted setup. An independent ceremony and external security review are required before mainnet.

### Services

- services/server.mjs: verified pool registration, encrypted order intake, persistent queue, indexing, batching, and redemption relay
- services/committee/member.mjs: DKG share custody, verified partial decryption, and exact batch attestation
- services/resolve-keeper.mjs: permissionless price-resolution calls using the selected oracle mode

Production registration validates market and pool linkage, collateral, resolver support, committee configuration, redeem key state, and the approved market and pool WASM hashes. Each committee member independently checks the pool WASM and its own committee membership before adding a user-created pool to its signing allowlist. ALLOW_UNVERIFIED_REGISTRATION=1 is for local tests only.

### Web

- /app: live market catalog
- /app/create: user-created oracle-backed price markets, with unsupported event categories clearly gated
- /app/market/[id]: lifecycle-aware market terminal, betting, rules, comments, and resolution actions
- /app/portfolio: position-specific redemption and refunds

Social features use wallet-signature authentication with Supabase. Comment images are validated before upload and associated with the authenticated wallet comment. Trade secrets never go to Supabase.

## Testnet deployments

The canonical record is [deployments/platform-hardening-testnet.json](deployments/platform-hardening-testnet.json).

| Component | Testnet value |
| --- | --- |
| Circle USDC SAC | CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA |
| Canonical market | CAXGT3SHUEVWLHA7PZKPNZCVGMEWLWCZTK6EQZWQABOL4NDBEPLRCU64 |
| Canonical shielded pool | CADIVW7SHMAFKTVU2P7IZ6UONFJWDXNQJFB4RRBE7KZFGXVSXWJEPKKP |
| Free price resolver | CATOCURLCPJXJNYOEBBV5Q2XVHO6S5J2ATZE6NP3A3DAJMUW3G43HNQ7 |
| Event resolver | CBOZK2JSSAOPXJWBSB6JZF5KLPMRQ52JCF4PADI7QUHQ3WS6KBKKBXW5 |
| Reflector CEX oracle | CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63 |
| Reflector fiat oracle | CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W |
| Market WASM | 7afca617a67b7f2d2dab4e9dc6836779871dff77fd876a2d83d62b435f5fa06a |
| Shielded pool WASM | 617e3d7e152b03ad53f5704abe92295ccfaa538771835c7b2174f00396af9363 |
| Price resolver WASM | fa2feaedc7622d45729e39e30a37946789934340a83bdd778981e7442194c06c |
| Event resolver WASM | 55f8711add9d5a8f8a9b865def5b0bbed3f8f9e1293d4392e533c555e4e5e3fa |

The active testnet registry accepts only new Circle USDC markets built from the approved contract hashes above. Older XLM experiments are not active product markets.

## Local development

Requirements:

- Node.js 22 or newer
- Rust and Cargo
- Stellar CLI with Soroban contract support

Install and test the web app:

    cd web
    npm install
    cp .env.example .env.local
    npm run zk:sync
    npm run test:unit
    PLAYWRIGHT_PORT=3101 npm run test:e2e
    npm run build

Run root contracts:

    cd contracts
    cargo test --workspace
    stellar contract build

Run the separate shielded-pool suite:

    cd contracts/shielded-pool/contract
    cargo test

Run service checks:

    cd services
    npm install
    node test-server.mjs

Copy services/.env.example to services/.env, keep both oracle mode variables set to free, and never put secret keys in committed files.

## Security status

This branch is for testnet beta hardening and has not been merged into main.

- Contracts and circuits are unaudited.
- The committee is currently a fixed 2-of-3 set.
- Threshold privacy fails if a quorum colludes.
- Browser position recovery depends on locally stored private data.
- Creator subsidy remains locked as market liquidity in the current beta design.
- Settlement and payouts require users or keepers to call permissionless actions. Nothing on-chain runs automatically by itself.
- Mainnet requires an independent trusted setup, external audit, independently operated committee members, production monitoring, and a separate deployment review.
