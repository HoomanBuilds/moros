# Moros payment services

- `payment-server.mjs` runs the payment API, relay, encrypted-output indexer, artifact serving, and recovery endpoints.
- `stellar-rpc-server.mjs` runs the shared Stellar RPC gateway with provider failover, CORS, and request limits.
- `payment-sync-factory.mjs` selects encrypted recovery persistence, including the existing Supabase integration.
- `deploy-payments.mjs` and its network wrappers are explicit contract deployment tools.
- `prepare-payments-mainnet.mjs` prepares payment artifact records.

## Configuration

Copy `.env.example` to `.env`, preserve existing identity names, and configure the intended network, RPC providers, payment deployment paths, and service origins. Local deployment files are private state and must remain untracked.

The payment API selects its network through `MOROS_PAYMENT_NETWORK`. The shared RPC selects its profile through `MOROS_NETWORK`. Mainnet and testnet use separate public deployment records and private runtime directories.

```bash
npm ci
npm test
npm run start:stellar-rpc
npm run start:payments-mainnet
```

Run long-lived services separately. Payment API ports default to 8791 for mainnet and 8790 for testnet when installed through `deploy-vm.sh service`; the shared RPC defaults to 8788. Public HTTP routing is described by `Caddyfile.moros`.

## Service installation

```bash
./services/deploy-vm.sh provision
./services/deploy-vm.sh service
```

Provisioning installs runtime dependencies. Service installation configures payment services and the shared RPC for deployments whose local state and artifacts are already present. It does not deploy contracts or generate proving keys. Hosting for the web application is managed separately.

## Tests

`npm test` runs local unit tests with mocked transaction submission and external services. `test-payments-testnet.mjs` is an explicit on-chain test tool and is excluded from that command.
