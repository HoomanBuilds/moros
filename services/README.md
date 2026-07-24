# Moros testnet services

The active Moros runtime consists of `private-server.mjs` and `resolve-keeper.mjs`. Both load contract addresses and policy from `deployments/private-testnet.json`. Contract IDs and WASM hashes are not copied into environment variables.

## Active components

- `private-server.mjs` indexes shielded outputs, activates funded proposals, coordinates fixed private batches, serves encrypted allocation witnesses, relays proof-bound transactions, and discovers LP exits.
- `resolve-keeper.mjs` resolves eligible price markets and refreshes contract TTLs.
- `deploy-private-testnet.mjs` deploys and verifies the canonical testnet contract graph.

`server.mjs` and `committee/member.mjs` belong to the earlier isolated-pool prototype. The VM installer disables those units. They are not part of the canonical shared-vault runtime.

## Configuration

Copy `.env.example` to `.env` and fill the secret values locally.

The active runtime requires:

    RPC_URL=https://soroban-testnet.stellar.org
    NETWORK_PASSPHRASE=Test SDF Network ; September 2015
    NETWORK=testnet
    FUNDER_SK=<testnet runtime and fee payer secret>
    SUPABASE_URL=<public market registry project URL>
    SUPABASE_SERVICE_ROLE_KEY=<public market registry service role key>
    PRIVATE_SYNC_SUPABASE_URL=<server-only private sync project URL>
    PRIVATE_SYNC_SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
    MOROS_PUBLIC_DEPLOYMENT=deployments/private-testnet.json
    ORACLE_MODE=free

`MOROS_TESTNET_PRIVACY_SK` is optional. When set, it must contain the same testnet privacy identity used during deployment. When omitted, `FUNDER_SK` supplies that identity. Keep every secret out of git, logs, browser variables, and shared configuration.

The deployment command can use a separate Stellar deployer:

    DEPLOYER_SK=<dedicated contract deployer secret>
    ROUNDING_FUNDER_SK=<testnet USDC reserve funder secret>
    MOROS_DEPLOYMENT_NAME=Moros Testnet
    MOROS_DEPLOYMENT_SALT=moros-testnet-canonical

The public name remains `Moros Testnet`. Contract names do not include dates or version suffixes.

## Oracle modes

Free Reflector mode is mandatory for the current beta:

    ORACLE_MODE=free

The canonical resolver reads the free Reflector testnet CEX and fiat contracts recorded in the deployment manifest. The CEX feed covers supported crypto assets. The fiat feed covers supported FX assets and XAU. Both feeds belong to one provider family and are not presented as independent-provider redundancy.

Pyth Pro remains available as a future paid switch:

    ORACLE_MODE=pyth_pro
    PYTH_PRO_RESOLVER_ID=<paid resolver contract>
    PYTH_ACCESS_TOKEN=<paid access token>

There is no paid resolver default and no arbitrary free-resolver override.

## Private HTTP API

- `GET /health` and `GET /private/health` return runtime health.
- `GET /private/config` returns the canonical deployment and proving artifact manifest.
- `GET /private/tree` returns locally verifiable encrypted output pages.
- `GET /private/allocation` returns an authenticated encrypted allocation witness.
- `GET /private/markets` returns chain-verified active private market registrations.
- `GET /private/exits` returns paginated, chain-verified active LP exits.
- `POST /private/register-proposal` registers a user-created market proposal for automatic funding.
- `POST /private/register-market` recovers an activated market registration.
- `POST /private/register-exit` recovers an on-chain LP exit listing.
- `POST /private/relay` submits a proof-bound transaction with no wallet authorization.

LP exit listings contain public ledger identifiers only. Ownership is recovered in the browser from the encrypted exit receipt. The service verifies the market, vault controller, exit intent, and current snapshot before listing an offer.

## Batch behavior

- Each batch contains exactly eight encrypted orders.
- Each order may represent any valid positive integer quantity.
- Every batch requires at least two YES orders and two NO orders.
- Every order in one batch receives the same clearing price.
- A full batch is executed atomically, so a later user cannot trade against stale visible odds from a partially applied batch.
- Pending orders remain encrypted and refundable under the configured close and finalization rules when they cannot execute.
- Runtime queues, used nullifiers, encrypted allocations, and output indexes persist across restarts.

The current testnet coordinator holds the combined committee secret on one VM. This is an explicit testnet limitation, not threshold privacy.

## Running and testing

Install dependencies and run the service tests:

    npm install
    npm test

Verify live free-oracle availability:

    npm run verify:oracles

Check the active entry points:

    node --check private-server.mjs
    node --check resolve-keeper.mjs
    node --check deploy-private-testnet.mjs
    bash -n deploy-vm.sh

## VM packaging

The packaged proving artifacts must match the verification keys in the canonical deployment:

    ./services/deploy-vm.sh package

After copying and unpacking `deploy-bundle.tar.gz` on the testnet VM:

    ./services/deploy-vm.sh provision
    ./services/deploy-vm.sh service

The service command installs and starts only `zkmarket-private` and `zkmarket-resolve-keeper`. It stops and removes earlier intake and committee-member units to prevent stale contract wiring.

Terminate TLS in front of the public service. Back up the private runtime directory and keeper state. Monitor service health, Stellar RPC access, Supabase access, market activation, batch settlement, resolution, refunds, claims, and TTL refreshes.

## Operational limits

- Contracts, circuits, and services are unaudited.
- The current trusted setup is for development.
- The single-VM testnet coordinator can recover individual encrypted order values.
- Price resolution and proof relaying require an operator or user to submit transactions.
- Event markets remain disabled until their evidence, challenge, arbitration, timeout, and refund operations are implemented and monitored.
- Mainnet requires an independent trusted setup, external security review, redundant monitored services, and independently operated threshold committee members.
