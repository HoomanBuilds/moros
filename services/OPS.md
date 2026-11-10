# Moros payment operations

## Configuration and identity continuity

Keep `services/.env`, any service-specific environment files, `deployments/*.local.json`, Stellar CLI identity files, recovery secrets, and Supabase credentials outside Git. Restrict private files to their owner. Back up the exact bytes and verify checksums before moving or replacing an installation.

The service installer reads the configured identity names and deployment paths. Moving repositories does not require generating replacement Stellar accounts, treasury identities, relay signing seeds, or payment recovery keys.

## Services

- `moros-stellar-rpc`: shared Stellar RPC, provider failover, CORS, and client/global limits.
- `zkmarket-payments-mainnet`: existing mainnet payment API, relay, output indexing, and encrypted recovery.
- `zkmarket-payments-testnet`: optional testnet payment service with separate state.

The existing payment unit names are retained for operational continuity. The source workspace, runtime installer, and tests contain payment functionality only.

## Monitoring

Watch payment health, indexed ledger progress, RPC errors and failover, relay balances, request failures, proof artifact availability, and encrypted sync failures. Investigate a stalled output index before suggesting that users replace or recreate payment identities.

## Recovery

Restore the corresponding public deployment record, private local deployment state, environment configuration, and original Stellar identity files together. Verify network, vault, verifier, token, and artifact hashes before starting the service. Keep mainnet and testnet state separate.

Use the same payment identity and encrypted recovery data on a new browser origin. Browser-local encrypted wallet storage is scoped to its origin; the existing payment hostname remains available for continuity.
