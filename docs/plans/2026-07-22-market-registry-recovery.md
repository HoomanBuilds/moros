# Market Registry Recovery Plan

## Goal

Repair the post-deployment market activation flow for market `CBY77FPDO42R3DBV24ISMF3SR372AQU22AYRYF66ZS4PNDTC3F2GW3I7` and pool `CDJXZTCZX5AHNISWZELENTIZTEUXDJE4PFU7NQRFAIE7S76DAE3IYHCF` without redeploying contracts or charging the creator subsidy again.

## Work

1. Confirm the market and pool are linked on Stellar testnet and registered with the committee service.
2. Confirm whether the Supabase registry row exists and capture the precise authentication, policy, or schema error.
3. Correct the registry write and recovery flow while preserving the deployment checkpoint.
4. Add coverage for failed listing, retry, authentication refresh, and actionable error reporting.
5. Validate unit tests, TypeScript, lint, production build, browser tests, and the exact recovery path.

## Release Gate

- Retry never submits another deployment transaction.
- Retry never transfers another market subsidy.
- Authenticated creators can insert or update their own market registry row.
- The exact market becomes visible from another browser through the public registry.
- Committee registration and onchain market-pool links remain valid.

## Result

- Stellar testnet confirms the market and pool are linked and controlled by the creator wallet.
- The committee already had the shielded pool registered and ready.
- The registry write trusted a cached browser session and reduced every database failure to a generic false result.
- Registry writes now validate the user with Supabase, refresh wallet authentication when needed, confirm the returned market ID, and preserve actionable database errors.
- The exact failed market was listed without another contract deployment or creator subsidy payment.
- A fresh browser can discover and open the recovered market from the production public registry.
- Unit tests, TypeScript checks, lint, production build, and all browser tests pass.
