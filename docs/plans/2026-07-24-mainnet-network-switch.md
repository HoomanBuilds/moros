# Mainnet network switch and readiness plan

## Scope

Prepare one codebase for testnet and mainnet without deploying to mainnet and without changing contract business logic.

The selected network must control:

- Network passphrase
- Stellar RPC and Horizon endpoints
- Circle USDC issuer and SAC
- Moros deployment manifest
- Reflector oracle contracts and supported assets
- Runtime fee signer and privacy coordinator secret
- Private service URL
- Wallet network
- Explorer links and network-specific UI labels

Every process must fail before serving traffic when its selected network, RPC, deployment manifest, collateral, proving artifacts, or oracle configuration disagree.

## Canonical switches

### Frontend

`NEXT_PUBLIC_STELLAR_NETWORK` selects `testnet` or `mainnet`.

The selected value reads the matching scoped variables:

- `NEXT_PUBLIC_TESTNET_STELLAR_RPC_URL`
- `NEXT_PUBLIC_MAINNET_STELLAR_RPC_URL`
- `NEXT_PUBLIC_TESTNET_STELLAR_HORIZON_URL`
- `NEXT_PUBLIC_MAINNET_STELLAR_HORIZON_URL`
- `NEXT_PUBLIC_TESTNET_PRIVATE_SERVICE_URL`
- `NEXT_PUBLIC_MAINNET_PRIVATE_SERVICE_URL`

Changing a public Next.js environment variable requires a new frontend deployment because public values are embedded during the build.

### Services

`MOROS_NETWORK` selects `testnet` or `mainnet`.

The selected value reads the matching scoped variables:

- `MOROS_TESTNET_RPC_URL`
- `MOROS_MAINNET_RPC_URL`
- `MOROS_TESTNET_HORIZON_URL`
- `MOROS_MAINNET_HORIZON_URL`
- `MOROS_TESTNET_DEPLOYMENT`
- `MOROS_MAINNET_DEPLOYMENT`
- `MOROS_TESTNET_ZK_PUBLIC_DIR`
- `MOROS_MAINNET_ZK_PUBLIC_DIR`
- `MOROS_TESTNET_FUNDER_SK`
- `MOROS_MAINNET_FUNDER_SK`
- `MOROS_TESTNET_PRIVACY_SK`
- `MOROS_MAINNET_PRIVACY_SK`

After both network profiles are populated, switching `MOROS_NETWORK` and restarting the service selects the matching profile. Existing generic variables remain supported as explicit compatibility overrides, but the runtime validates the selected passphrase and deployment network.

## Canonical addresses

### Testnet

- Circle USDC issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- Circle USDC SAC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Reflector CEX: `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63`
- Reflector fiat: `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W`
- Moros contracts: `deployments/private-testnet.json`

### Mainnet

- Circle USDC issuer: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- Circle USDC SAC: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`
- Reflector CEX: `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN`
- Reflector fiat: `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC`
- Moros contracts: future `deployments/private-mainnet.json`

The mainnet Moros manifest must not be created with placeholder addresses. Mainnet mode must remain unavailable until a real deployment writes a complete manifest marked mainnet ready.

## Free mainnet oracle policy

Use the free public Reflector CEX and fiat contracts for the initial price-only mainnet release.

Verified mainnet CEX assets:

- BTC
- ETH
- USDT
- XRP
- SOL
- USDC
- ADA
- AVAX
- DOT
- MATIC
- LINK
- DAI
- ATOM
- XLM
- UNI
- EURC

Verified mainnet fiat and metal assets:

- EUR
- GBP
- CAD
- BRL
- JPY
- CNY
- MXN
- KRW
- TRY
- ARS
- PEN
- VES
- CLP
- CRC
- CDF
- COP
- HKD
- INR
- NGN
- PHP
- RUB
- ZAR
- XAU
- KES

The mainnet feeds use USD as the base, 14 decimals, a 300-second resolution, and a minimum 86,400-second history retention period.

Do not advertise testnet-only CHF or THB in mainnet mode.

The Band mainnet reference contract is live and returned XLM/USD and USDC/USD during this review, but it does not implement the SEP-40 interface consumed by the current resolver. It remains disabled unless a reviewed adapter is deployed. Pyth Pro remains compiled but disabled because production historical payload access requires an authenticated subscription. DIA has no listed mainnet Stellar public contract.

## Contract resource review

No contract business logic change is planned in this task.

The workspace already uses the correct size-focused release profile:

- `opt-level = "z"`
- Link-time optimization
- One codegen unit
- Symbols stripped
- Panic abort
- Debug disabled
- Overflow checks retained for financial safety

Current optimized WASM sizes:

- Event resolver: 18,223 bytes
- LMSR market: 50,746 bytes
- Market liquidity vault: 30,210 bytes
- Market factory: 35,277 bytes
- Pooled liquidity vault: 35,480 bytes
- Price resolver: 20,615 bytes
- Shielded collateral vault: 105,979 bytes
- ZK verifier: 23,044 bytes

All are below the 128 KB network limit. The shielded vault is the closest and should be monitored on every dependency or feature change.

Hot-path loops are bounded by fixed protocol limits:

- Private batches: maximum 8 orders
- Merkle paths: fixed 20 levels
- Pooled active allocations: maximum 8
- Resolver sources: deployment-controlled small list
- Verifier public inputs: circuit-key controlled

The expensive operations are ZK verification, persistent Merkle state writes, encrypted output events, and cross-contract settlement. These are required by the privacy model. Mainnet deployment should record simulated resource fees for shielding, betting, batch settlement, claiming, LP allocation, LP withdrawal, and market resolution before setting product limits.

## Implementation order

1. Add a shared service network selector with strict passphrase and deployment-path selection.
2. Split service oracle contracts and asset coverage by network.
3. Update the private service and keeper to load the selected network profile and fail closed on manifest mismatch.
4. Update committee signing helpers to use the configured network passphrase.
5. Update deployment packaging to include all canonical deployment manifests.
6. Make frontend network parsing strict and select scoped RPC, Horizon, service, collateral, oracle, asset, wallet, explorer, and copy values.
7. Generalize private deployment and proving-manifest validation to the selected network.
8. Keep mainnet unavailable until the real mainnet deployment and mainnet proving manifest exist.
9. Run focused configuration and build checks only. Do not deploy mainnet.

## Mainnet blockers outside this task

- Real `deployments/private-mainnet.json`
- Mainnet proving manifest and independent trusted setup
- Mainnet runtime and fee-payer accounts
- Independent security review
- Redundant RPC operations and monitoring
- A committee design appropriate for real funds rather than the current single-VM testnet coordinator
- Limited liability caps and incident procedures
