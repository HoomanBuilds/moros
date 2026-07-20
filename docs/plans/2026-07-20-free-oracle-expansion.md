# Free oracle expansion plan

## Goal

Expand Moros testnet markets beyond the original crypto list while keeping every active data dependency free and verifiable on Stellar.

## Work

1. Verify current Stellar testnet contracts, interfaces, feed assets, retention, and pricing.
2. Keep Pyth Pro available behind `pyth_pro`, but do not activate its trial or unsigned proxy.
3. Add the free Reflector CEX and fiat contracts to the price resolver.
4. Enforce USD as the base asset for every SEP-40 source.
5. Add crypto, FX, and XAU price market categories based on live Reflector coverage.
6. Add equities, commodities, sports, economics, weather, politics, technology, entertainment, and custom event categories.
7. Require event creators to provide a primary source, backup source URLs, exact YES rules, and exact VOID rules.
8. Keep event settlement behind a USDC bond, a challenge window, committee arbitration, and a permissionless timeout to VOID.
9. Read price previews from the same on-chain Reflector contracts used for settlement.
10. Test contract safety, asset coverage, rules hashing, metadata recovery, and web flows.
11. Deploy only the expanded free resolver to Stellar testnet.

## Release rule

The branch remains unmerged until the user verifies the complete flow. Mainnet deployment is outside this testnet task.
