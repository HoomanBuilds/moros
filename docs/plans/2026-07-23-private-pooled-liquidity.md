# Private pooled liquidity implementation plan

## Goal

Replace manual per-market LP funding with one private Moros liquidity pool while preserving isolated market risk cells and exact solvency accounting.

Keep `main` unchanged until the deployed testnet flow is verified by the user.

## Work package 1: Lock pool math and state tests

- Add reference fixtures for virtual shares, ceiling deposit NAV, floor withdrawal NAV, direct donations, rate limits, and terminal profit and loss.
- Add allocation-cap fixtures for one market, one risk group, total deployed capital, active count, and idle reserve.
- Add FIFO candidate and queued-exit state-machine tests.
- Add random action sequences covering deposits, allocations, batches, exits, resolutions, voids, and harvests.

Gate: every atomic USDC unit belongs to one named accounting class after every action.

## Work package 2: Add the pooled liquidity vault

- Add `contracts/pooled-liquidity-vault/`.
- Store token, factory, shared vault, governance, immutable risk policy, tracked idle assets, total shares, state version, queue indexes, active allocations, group exposure, and withdrawal-window state.
- Implement deposit preview and transfer-verified deposit receipt.
- Implement deposit NAV and withdrawal NAV from bounded cell reads.
- Implement immediate redemption preview and transfer-verified redemption.
- Ignore direct SAC donations in NAV and share math.
- Emit deposit, redemption, candidate, allocation, harvest, and limiter events.

Gate: contract unit tests cover all rounding, stale-state, donation, cap, authorization, and transfer errors.

## Work package 3: Add deterministic market allocation

- Register one FIFO candidate from the factory after cell deployment.
- Derive risk group from factory-owned asset mapping.
- Make candidate processing permissionless.
- Fund only the next eligible candidate.
- Require one exact target allocation.
- Make the pooled vault the sole cell share controller.
- Track cell shares, principal, group, and lifecycle.
- Harvest terminal cells permissionlessly.

Gate: no caller or keeper can reorder candidates, bypass a risk cap, or direct capital to an unsupported cell.

## Work package 4: Rewire factory and market cells

- Add pooled vault and asset risk-group mapping to factory configuration.
- Deploy each market cell with the pooled vault as controller.
- Register the cell with the pooled vault.
- Keep proposal creation free of creator USDC.
- Mark Ready only after the pool funds the exact target.
- Keep activation, shared-vault registration, market linkage, and oracle checks atomic.
- Update deployment identity and WASM hash checks.

Gate: a creator with zero USDC can propose a market, automatic pool allocation can fund it, and any caller can activate it.

## Work package 5: Add private pool-share actions

- Reuse one-input private liquidity funding for global pool shares.
- Bind pool-share notes to the pooled vault address.
- Add minimum-share and maximum-asset slippage bounds.
- Reuse private liquidity redemption for immediate exits.
- Add pool exit request, cancellation, processing, and claim proof formats.
- Return every exit to reusable private USDC.
- Keep pool ownership and personal profit and loss out of Supabase.

Gate: one private USDC deposit can fund the pool, place bets, redeem pool shares, and continue spending without another wallet prompt.

## Work package 6: Add automation and recovery

- Add a permissionless pool keeper loop for next-candidate allocation, factory funding sync, activation, terminal harvest, and queued-exit processing.
- Persist only public queue and allocation cursors in services.
- Add idempotent restart tests.
- Add CLI recovery for pool shares, immediate redemption, queued exit, cancellation, and claim.
- Add health checks for token, factory, shared vault, pool, cell, market, resolver, committee, and artifact identities.

Gate: stopping Moros services removes automation only. Any caller can still progress every public lifecycle step.

## Work package 7: Replace the liquidity UI

- Replace per-market funding controls with one Moros liquidity pool page.
- Use the Portfolio private USDC balance.
- Add arbitrary deposit and share redemption amounts.
- Show pool size, idle assets, deployed principal, active markets, deposit NAV, withdrawal NAV, immediate availability, risk spread, and limiter reset.
- Show allocation exposure by market and risk group without exposing LP identity.
- Show personal pool shares and private estimated range only after wallet unlock.
- Route insufficient private USDC to Portfolio.
- Remove public controls that ask a user to fund one market manually.
- Show market proposals as waiting for automatic pool capacity, ready, active, cancelled, or expired.

Gate: desktop and mobile users can understand the pool, fund once, and never choose a market allocation.

## Work package 8: Redeploy and verify

- Build and hash the pooled vault, market cell, factory, market, shared vault, verifier, and resolver artifacts.
- Deploy a fresh testnet pool, factory, cells, markets, verifier, and shared vault.
- Wire frontend, service API, keeper, committee, relayer, indexer, and registry to one manifest.
- Clear the reset Supabase market catalog only after the new manifest is verified.
- Run multi-user profit, loss, void, capacity, run, delayed oracle, service outage, and clean-browser recovery tests.
- Run `cargo clean` and verify no target directory remains.

Gate: the user verifies the live testnet flow before merge to `main`.

## Logical commits

1. `docs: specify private pooled liquidity`
2. `feat: add pooled liquidity vault`
3. `feat: add deterministic pool allocation`
4. `feat: wire factory pooled liquidity`
5. `feat: add private pool exit proofs`
6. `feat: automate pooled market funding`
7. `feat: add pooled liquidity experience`
8. `test: verify pooled liquidity lifecycle`

Split a commit further when one contract, proof, service, or UI unit has independent tests.
