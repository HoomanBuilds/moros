<p align="center">
  <img src="web/public/logo.png" alt="Moros logo" width="120" />
</p>

<h1 align="center">Moros</h1>

<p align="center">
  <b>Private binary prediction markets on Stellar.</b>
</p>

Moros lets any connected user propose a price market, trade encrypted YES or NO positions, provide pooled liquidity, and claim a proof-bound payout. Markets use Circle USDC on Stellar. XLM is required only for network fees and account reserves.

Moros is an unaudited testnet beta. Do not use it with real funds. Old testnet deployments and registry records are not loaded into the current application.

## Current product

- User-created crypto, FX, and gold price markets
- Circle USDC collateral
- Creator-free market proposals
- Permissionless pooled liquidity with isolated per-market risk
- Reusable private USDC balances
- Variable position quantities from 1 through 1,000
- Browser-generated BN254 Groth16 proofs
- Eight-order atomic batches with one clearing price
- Proof-based claims, refunds, transfers, LP funding, and withdrawals
- Wallet-authenticated comments with optional images
- Free Reflector price resolution on testnet
- Optional Pyth Pro support behind an explicit operator switch

Sports, politics, weather, economics, and other event markets remain disabled. Their creation flow will not open until evidence observers, challenges, arbitration, timeout handling, refunds, and production monitoring are operational.

## Market lifecycle

### 1. Propose

Any connected user can propose a supported market from `/app/create`. The proposer chooses an asset, USD strike, and exact future settlement time. The browser hashes the canonical rules and submits the proposal through the market factory.

The proposer does not need USDC and does not fund the market. A proposal becomes active only when the pooled liquidity system can allocate the configured USDC target to its isolated market vault. Unsupported assets, fees, liquidity targets, and timing values fail before funding.

### 2. Fund liquidity

Any user may shield USDC and deposit it into the shared permissionless liquidity pool. LP shares represent a pro rata claim on current pool equity, including realized market profit, loss, and vested LP fees. Returns are not guaranteed.

The pool keeps at least 20% idle under the current testnet policy and deploys at most 80% across eligible markets. Each market receives an isolated allocation. One market cannot spend another market's reserved capital.

Public deposits and final withdrawals are visible Stellar boundaries. Internal LP ownership, market allocation, exits, and redemption use private notes and proof relaying.

### 3. Place private positions

A user first shields any positive supported USDC amount into one reusable private balance. The same private balance can fund positions, LP shares, transfers, claims, refunds, and later withdrawals.

Each position has a private side and a user-selected whole-number quantity. The browser generates a proof locally and relays the proof-bound action. Proving WASM and proving keys are intentionally public. Security depends on private witness values and the immutable on-chain verification keys, not on hiding proving artifacts.

The public shield or withdrawal boundary reveals the transferred amount and wallet. Internal note ownership, balance changes, sides, quantities, allocations, and claims are not stored in plaintext in Supabase.

### 4. Execute an atomic batch

Each batch contains exactly eight encrypted orders and requires at least two YES orders and two NO orders. Every order in the batch receives the same clearing price.

The visible LMSR price does not move while a batch is incomplete. The complete batch is proved and executed atomically, then the public price changes once. A later user cannot trade against a partially applied batch or gain a stale-price advantage from an earlier order.

Orders may use different quantities. A user may place multiple positions while the market and current batch window remain open. An incomplete batch never moves price. Its pending orders become privately refundable after the configured close and refund delay.

### 5. Resolve

The current testnet resolver uses free Reflector CEX feeds for crypto assets and the Reflector fiat feed for FX and XAU. Moros checks the requested pair, historical settlement time, freshness, decimals, and configured availability rules.

Reflector is one provider family. Moros does not present its CEX and fiat contracts as independent-provider redundancy. If a usable price remains unavailable through the resolution timeout, the market becomes permissionlessly voidable.

Pyth Pro support remains available only as a paid operator mode. It has no default resolver or access token and cannot activate through a generic override.

### 6. Claim, refund, and harvest

Payouts are pull-based. Resolution does not push funds to every wallet.

- A winning user generates a private claim proof.
- A losing position has no payout action.
- A void market returns each position's terminal value without vesting platform or LP fees.
- An order from an incomplete batch becomes privately refundable.
- Nullifiers and state-bound proofs prevent replay.
- The runtime harvests terminal market capital back into the pooled LP after resolution or voiding.

The portfolio shows private activity recovered for the connected wallet. Claim and refund actions appear only when the position is eligible.

## Fees

New private markets use an execution-time fee based on the batch clearing probability:

    trade_fee = quantity * lot_size * fee_rate * p * (1 - p)

The current market proposal fee parameter is 2%, capped by the factory at 10%. The probability term makes the charged amount smaller than 2% of the maximum position payout and symmetric for YES and NO at complementary prices.

After reimbursement of exact batch rounding capital, 80% of vested execution fees goes to pooled LP equity and 20% goes to the Moros protocol treasury. VOID and incomplete-batch refunds do not create platform revenue.

## Oracle modes

The current beta runs in free mode:

    ORACLE_MODE=free
    NEXT_PUBLIC_ORACLE_MODE=free

The optional paid integration remains available:

    ORACLE_MODE=pyth_pro
    NEXT_PUBLIC_ORACLE_MODE=pyth_pro
    PYTH_PRO_RESOLVER_ID=<deployed paid resolver>
    NEXT_PUBLIC_PYTH_PRO_PRICE_RESOLVER_ID=<deployed paid resolver>
    PYTH_ACCESS_TOKEN=<paid access token>

Public Band and DIA addresses from older testnet deployments are not configured as backups.

## Architecture

### Contracts

- `contracts/market-factory`: creator-free proposals, capability gates, deterministic market deployment, and LP-backed activation
- `contracts/lmsr-market`: binary LMSR pricing, atomic batches, lifecycle, resolution, and terminal LP accounting
- `contracts/market-liquidity-vault`: isolated per-market LP capital and terminal redemption
- `contracts/pooled-liquidity-vault`: shared LP shares, risk limits, allocation queue, NAV, withdrawals, and harvests
- `contracts/shielded-collateral-vault`: reusable private USDC notes, orders, claims, refunds, LP actions, outputs, roots, and nullifiers
- `contracts/zk-verifier`: immutable BN254 Groth16 verification keys and typed proof verification
- `contracts/resolver`: free Reflector resolution, optional verified Pyth data, and stale-market voiding
- `contracts/event-resolver`: inactive event-resolution foundation for future operational work

### Proof circuits

The private stack includes typed circuits for deposits, transfers, withdrawals, orders, claims, refunds, execution change, LP funding, LP redemption, LP exits, treasury actions, exit replacement, and complete batch execution.

The circuits use Groth16 over BN254. Verification keys are finalized in the deployed verifier. The current proving setup is for development. An independent ceremony and external security review are required before mainnet.

### Services

Only two Moros services are active:

- `services/private-server.mjs`: output indexing, private proof relaying, proposal activation, pooled LP allocation, fixed-batch coordination, encrypted allocation witnesses, terminal finalization, and LP harvest
- `services/resolve-keeper.mjs`: supported price resolution and contract TTL maintenance

Both services load contract IDs and policy from `deployments/private-testnet.json`. Contract addresses are not duplicated in environment variables.

The current testnet coordinator holds the combined committee secret on one VM. This is a testnet limitation and is not threshold privacy. Mainnet requires independently operated committee members, threshold key custody, redundant services, monitoring, and recovery procedures.

### Web and Supabase

- `/app`: current-deployment market catalog
- `/app/create`: creator-free price market proposals with exact local time selection
- `/app/market/[id]`: lifecycle-aware market terminal, variable private positions, rules, comments, and resolution state
- `/app/portfolio`: reusable private USDC balance, encrypted activity history, claims, and refunds
- `/app/liquidity`: automatic pooled LP deposits, equity, fees, and withdrawals

Social records use wallet-signature authentication. Comment images are validated before upload and belong to the authenticated wallet comment.

Private activity sync stores only fixed-size encrypted pages behind server-only credentials. The wallet derives the encryption and viewing material needed to recover its own activity. Supabase operators do not receive plaintext sides, quantities, note ownership, balances, claims, or LP allocations.

## Testnet deployment

The canonical record is [deployments/private-testnet.json](deployments/private-testnet.json).

| Component | Testnet value |
| --- | --- |
| Circle USDC SAC | CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA |
| Market factory | CCPRPUNRJV2CCHN2ENZAJKSV3PVN2HH2LHXDDZZQNGFUEAZNCBVRB52D |
| Shared collateral vault | CBGZDC64P5LGMGCKUUIQDCXNYE2E4LA66O2GHFQFG2QPX67KO6V2YZR2 |
| Pooled liquidity vault | CDYJTE5J54ITTKVDYENR7UQTBVKTY4LOHQJAHF5YRVJZDA77YJI5S3WX |
| Groth16 verifier | CBGUQRKJLNZZS4L2PZYKHAGR7CXOTJFISYM27D7HYDAIF32AXO47WKUL |
| Free price resolver | CCZNETDY464HA2RCXPIEFM56W3NRT3GHQ7GUPWZS6LWMILCERDADSKJT |
| Market WASM | 1b6661c230955a5452fa841a8df6dbed99b17165dede73b3b5e8b319ecf5a9d3 |
| Liquidity vault WASM | 28ab6ba66df7e5512be4050e6000adc0786d8a75a9faf13e331c9907893b8b08 |

The application, services, keeper, and live tests reject registry records that do not match this factory, shared vault, Circle USDC SAC, and active market state.

## Local development

Requirements:

- Node.js 22 or newer
- Rust and Cargo
- Stellar CLI with Soroban contract support

Run web checks:

    cd web
    npm install
    cp .env.example .env.local
    npm run test:unit
    npm run test:e2e
    npm run build

Run contract checks:

    cd contracts
    cargo test --workspace
    cargo clean

Run service checks:

    cd services
    npm install
    npm test
    npm run verify:oracles

Copy `services/.env.example` to `services/.env`, keep oracle mode set to free, and never put secret keys in committed files.

## Security status

- Contracts, circuits, and services are unaudited.
- The trusted setup is for development.
- The single-VM testnet coordinator can recover individual encrypted order values.
- Public deposits and final withdrawals expose their Stellar wallet and amount.
- Reflector is the only active oracle provider family.
- Event market creation is disabled.
- Payouts require permissionless user or service transactions. Nothing on-chain runs by itself.
- Mainnet is disabled in the current deployment manifest.
- Mainnet requires an independent trusted setup, external security review, distributed committee custody, redundant operators, production monitoring, and a separate deployment review.
