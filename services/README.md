# Moros committee and resolution services

These Node.js services support the Moros testnet beta. They do not custody plaintext order openings. The browser sends an encrypted order and a Groth16 proof that binds it to an on-chain commitment and the current committee key.

## Components

- server.mjs runs multi-pool registration, event indexing, encrypted order intake, persistent queues, batch coordination, and redemption relay.
- committee/member.mjs holds one DKG share, verifies exact encrypted orders and aggregate decryptions, and signs only valid batch authorization entries.
- resolve-keeper.mjs calls the configured price resolver after eligible price markets expire.
- relayer.mjs submits proof-bound redemption transactions.

## Testnet configuration

Copy .env.example to .env and fill secret values locally.

Required production-like settings:

    RPC_URL=https://soroban-testnet.stellar.org
    NETWORK_PASSPHRASE=Test SDF Network ; September 2015
    ORACLE_MODE=free
    FREE_RESOLVER_ID=CAIHZHCNKHLCXGWOTH7T2L4S5YDNNGO6Q6MSDQ7HQ3A4IORN4NE6ZF5B
    POOL_WASM_HASH=ec67aee3f9391ca358e52cfad5ac05c39ea9b09dc4abc575177272f2b79b5ef3
    COLLATERAL_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
    ALLOW_UNVERIFIED_REGISTRATION=0
    SERVICE_TOKEN=<random operator token>
    MEMBER_TOKEN=<different random committee token>
    FUNDER_SK=<testnet fee payer secret>
    READER_ADDRESS=<testnet public address>
    MEMBERS=http://member1:9711,http://member2:9712,http://member3:9713

Keep FUNDER_SK and every MEMBER_SK out of git, logs, browser variables, and shared configuration.

## Free and paid oracle modes

Free Reflector mode is mandatory for the current beta:

    ORACLE_MODE=free

This resolver reads both live free Reflector testnet contracts. The CEX feed covers supported crypto assets. The fiat feed covers supported FX assets and XAU. The contracts expand coverage but belong to one provider family, so the beta does not describe them as independent provider quorum.

Pyth Pro support remains in the keeper for future use. It runs only when all of these are explicitly configured:

    ORACLE_MODE=pyth_pro
    PYTH_PRO_RESOLVER_ID=<paid resolver contract>
    PYTH_ACCESS_TOKEN=<paid access token>

There is no paid resolver default and no generic resolver override.

## Public HTTP endpoints

- GET /health returns service health.
- GET /pk returns the current committee encryption key.
- GET /status returns pool and queue status.
- GET /proof/:commitment returns a persisted Merkle membership proof.
- POST /register-pool registers a protocol v3 market and pool after on-chain validation.
- POST /order verifies and queues an encrypted order.
- POST /redeem relays a proof-bound redemption.

POST /batch is an operator action and requires SERVICE_TOKEN.

Public pool registration validates:

- Protocol version 3
- Two-way market and pool linkage
- Matching collateral
- Expected 2-of-3 committee configuration
- Configured v3 redemption verification key
- Approved pool WASM hash

ALLOW_UNVERIFIED_REGISTRATION=1 bypasses these checks and is allowed only in local tests.

## Batch behavior

- Open markets settle full batches of four.
- Closed markets may settle a final private batch of two to four before finalize_after.
- A single pending order is never decrypted as its own batch.
- Pending orders become refundable after finalize_after.
- Queues and used nullifiers persist across restarts.
- Each pool has an isolated queue and event index.
- Committee members recompute the proof-bound commitments, nullifier hashes, aggregate ciphertext, decrypted net, and authorization entry before signing.

## Running locally

Install dependencies:

    npm install

Run the hosted service test:

    node test-server.mjs

Run service syntax checks:

    node --check server.mjs
    node --check resolve-keeper.mjs
    node --check relayer.mjs
    node --check indexer.mjs
    node --check committee/member.mjs
    node --check committee/submit-multisig.mjs

Verify the live free Stellar oracle contracts and exact asset coverage:

    npm run verify:oracles

The test server uses ALLOW_UNVERIFIED_REGISTRATION=1, DRY_RUN=1, temporary queue files, and temporary committee shares. Those values are not production settings.

## VM packaging

The proving artifacts and native helper binaries must match the deployed verification keys.

On the build machine:

    ./services/deploy-vm.sh package

On the testnet VM after unpacking the bundle:

    ./services/deploy-vm.sh provision
    ./services/deploy-vm.sh service

Terminate TLS in front of the public service. Run committee members on independently operated hosts before treating threshold privacy as meaningful. The bundled single-VM setup is for testnet operations only.

## Operational limits

- Current services and contracts are unaudited.
- The committee is a fixed 2-of-3 set.
- A colluding quorum can break threshold privacy.
- Stellar RPC event retention requires the persistent index to stay healthy and backed up.
- The final order queue must be monitored so eligible short batches settle before finalize_after.
- Price resolution and redemption are permissionless calls, but they still require a keeper, relayer, or user to submit transactions.
- Nothing runs automatically merely because a market has expired or resolved.
