# Private pooled liquidity specification

## Status

Required for the Moros testnet reset. This specification supersedes direct user funding of individual market liquidity vaults. It keeps isolated market accounting from the existing liquidity specification.

## User outcome

- A user shields USDC once in Portfolio.
- A user allocates any supported amount from that private balance to one Moros liquidity pool.
- The user receives private pool-share notes.
- The pool allocates capital to eligible markets automatically.
- The user does not select or manually fund an individual market.
- Pool-share value changes with realized market profit, loss, and the LP share of execution fees.
- A user can redeem pool shares when safe idle liquidity is available.
- A user can request an exit at any time. A queued exit completes as capital returns from markets and passes the withdrawal limiter.
- Returned USDC becomes reusable private USDC, not a public wallet payment.

## Architecture

Moros uses two liquidity layers.

### Pooled liquidity vault

This is the only LP product exposed to users. It:

- Accepts USDC from the shared shielded collateral vault.
- Mints proportional private pool-share notes.
- Tracks idle USDC.
- Registers factory-approved allocation candidates in FIFO order.
- Applies immutable risk caps before allocation.
- Owns the shares of every funded market risk cell.
- Harvests terminal USDC from resolved, voided, or cancelled cells.
- Calculates conservative deposit and withdrawal values.
- Enforces an idle reserve and withdrawal rate limit.
- Never holds bettor liabilities or protocol treasury funds.

### Isolated market risk cell

Every market still receives one dedicated market liquidity vault. It:

- Accepts capital only from the pooled liquidity vault.
- Holds one market's exact principal and share accounting.
- Transfers the funded reserve only to its linked LMSR market.
- Receives that market's terminal equity.
- Prevents one market from calling or spending another market's cell.

Users never receive cell shares. The pooled vault is the sole owner and controller of cell shares.

## Why both layers are required

A single pooled balance directly shared by every LMSR market would make cross-market loss and authorization bugs harder to contain. A pool with isolated cells provides one-deposit UX while keeping exact per-market principal, scenario equity, terminal value, and failure boundaries.

## Private and public data

### Private

- Pool-share ownership.
- An LP's total shares.
- An LP's deposit history after the public shield boundary.
- An LP's redemption history before the public withdraw boundary.
- The link between one public USDC deposit and later pool actions, subject to timing limits.

### Public

- Total pool shares.
- Pool idle USDC.
- Total deployed principal.
- Pool deposit NAV and withdrawal NAV.
- Allocation queue state.
- Every market allocation amount, risk group, and lifecycle state.
- Per-market scenario equity and terminal result.
- Aggregate pool deposits and redemptions per transaction.
- Public Stellar deposits and final public withdrawals.

Supabase stores only encrypted private archive pages. It never stores plaintext pool ownership, share amount, private balance, or personal LP profit and loss.

## Share accounting

All amounts use Stellar USDC atomic units.

The vault uses immutable virtual assets and virtual shares to protect the first deposit and reduce rounding attacks.

For a deposit:

`shares_out = floor(assets_in * (total_shares + virtual_shares) / (deposit_nav + virtual_assets))`

For an immediate redemption:

`assets_out = floor(shares_in * (withdrawal_nav + virtual_assets) / (total_shares + virtual_shares))`

If there are no active allocations and the final holder redeems all shares, the holder receives the remaining tracked idle assets.

Direct SAC transfers do not increase tracked NAV, mint shares, satisfy risk caps, or become protocol revenue.

## Conservative valuation

For each active market:

`floor_value = min(equity_if_yes, equity_if_no) - conditional_lp_fees`

`ceiling_value = max(equity_if_yes, equity_if_no) - conditional_lp_fees`

Both values must be nonnegative.

Pool withdrawal NAV is:

`idle_assets + funding_cell_assets + terminal_cell_assets + sum(active_floor_value)`

Pool deposit NAV is:

`idle_assets + funding_cell_assets + terminal_cell_assets + sum(active_ceiling_value)`

Deposits use the ceiling value so a new depositor cannot dilute existing LPs by entering against a favorable unresolved scenario.

Redemptions use the floor value so an exiting LP cannot withdraw as if the favorable scenario were guaranteed.

Conditional LP fees are excluded until normal resolution vests them. Voids do not create LP fee value.

The difference between deposit NAV and withdrawal NAV is a risk spread, not protocol revenue. It protects existing and remaining pool shareholders from unresolved outcome selection.

## Allocation queue

- Only the configured factory can register a candidate.
- Registration occurs when the factory deploys the market risk cell.
- Candidates receive a monotonic FIFO sequence.
- Any caller can process the next candidate.
- A keeper only supplies liveness. It cannot bypass onchain eligibility or risk limits.
- An expired, cancelled, malformed, or already funded candidate is skipped onchain.
- An eligible candidate waits when capacity is insufficient.
- Deposits do not promise that a specific candidate will receive capital.

The factory marks a proposal Ready only after the pool has funded the exact target and the cell reports Ready.

## Allocation risk policy

All caps are immutable for one deployment.

- Maximum active market count.
- Maximum deployed principal as a percentage of pool deposit NAV.
- Maximum one-market principal as a percentage of pool deposit NAV.
- Maximum one-risk-group principal as a percentage of pool deposit NAV.
- Minimum idle assets as a percentage of pool withdrawal NAV.
- Maximum supported market duration.
- Approved liquidity tiers.
- Approved risk groups.

The factory derives each proposal's risk group from its approved asset mapping. A creator cannot choose a cheaper risk group.

Initial testnet policy:

- At most 8 active allocations.
- At most 80 percent of deposit NAV deployed.
- At most 80 percent of deposit NAV in one market during the early testnet bootstrap.
- At most 80 percent of deposit NAV in one risk group during the early testnet bootstrap.
- At least 20 percent of withdrawal NAV idle after an allocation.
- Crypto assets share one correlated risk group.
- FX assets share one correlated risk group.
- Gold uses the commodities risk group.

These are test parameters. The bootstrap caps let a 25 USDC pool fund the minimum 20 USDC market while retaining 5 USDC idle. Mainnet requires lower concentration limits based on measured testnet loss, utilization, and correlated-market exposure.

## Market allocation lifecycle

### Candidate

The factory has deployed an empty cell and registered it with the pool.

### Funded

The pool transfers the exact target to the cell and receives all cell shares. Partial pool allocation is not allowed.

### Active

The factory activates the market. The cell transfers its exact target to that market. The pool values the position from the cell's latest atomic market snapshot.

### Terminal

The market returns exact terminal equity to its cell after bettor liabilities and fee rules are complete.

### Harvested

Anyone calls the pool to burn all cell shares and return the cell's USDC to pool idle assets. The allocation leaves deployed and risk-group totals.

## Deposits

- Deposits use the same private USDC balance used for betting.
- The wallet opens only for the original public shield action or private recovery unlock.
- The pool deposit proof consumes one private USDC note.
- It creates one pool-share note and one reusable private USDC change note.
- The shared vault transfers the exact accepted amount to the pooled vault.
- The pooled vault verifies the transfer delta, state version, expected shares, and commitment uniqueness.
- Deposit slippage is bounded by user-provided minimum shares.
- Deposits fail atomically if NAV changes before execution.

## Immediate redemptions

- A redemption burns private pool shares and creates private USDC.
- It succeeds only when tracked idle assets cover the exact output.
- Active allocations must retain the configured idle reserve.
- A rolling withdrawal window limits total immediate outflow.
- The preview returns redeemable assets, immediate available assets, and the next limiter reset.
- A failed redemption does not consume the private share note.

## Queued exits

- A user may request an exit at any time.
- The request spends the selected pool-share note and creates a private exit receipt plus optional share change.
- The public queue stores share amount, minimum acceptable USDC, payment commitment, request sequence, and expiry. It does not store an LP wallet.
- FIFO processing marks an exit claimable only when current withdrawal NAV, idle reserve, and rate limit support it.
- Claiming spends the private receipt, transfers exact USDC from the pool to the shared vault, and creates the precommitted private USDC note.
- Expired unprocessed requests can be cancelled to restore pool shares.
- A request, cancellation, processing, or claim can succeed only once.

## Fees and pool profit

Moros does not charge LP deposit, management, or withdrawal fees.

The existing market execution fee is split at normal resolution:

- The configured LP share becomes part of terminal cell equity and therefore increases pool-share value.
- The configured protocol share becomes Moros treasury revenue.
- Voided markets vest neither share.

No second performance fee is charged at the pooled vault in the first testnet release. This avoids double charging LPs while the execution-fee economics are measured.

## Solvency and authorization invariants

1. Pool assets never count as bettor shielded liabilities.
2. Bettor assets never count as pool NAV.
3. The pool can fund only a factory-registered cell whose token, controller, proposal, target, deadline, and state match.
4. One cell can fund only its linked market.
5. A market can return terminal equity only to its own cell.
6. The pool owns every cell share and no user owns a direct cell claim.
7. One allocation cannot exceed any market, group, deployed, active-count, or idle cap.
8. A direct token donation never mints shares or changes NAV.
9. Deposit shares use current ceiling NAV and a minimum-share check.
10. Redemptions use current floor NAV and round down.
11. Conditional fees do not enter NAV before vesting.
12. Immediate and queued exits cannot withdraw deployed capital.
13. A queued claim cannot be processed, cancelled, or claimed twice.
14. Terminal harvest checks exact token balance movement.
15. Every cross-contract controller and factory call uses exact Soroban authorization.
16. Pool operations compare one monotonic state version.
17. Bounded vectors prevent unbounded contract work.

## Failure and recovery behavior

- Insufficient capacity leaves the proposal waiting without taking creator or LP funds.
- A missed funding deadline makes the cell cancellable and advances the allocation queue.
- A failed activation leaves the pool-owned cell refundable.
- A delayed oracle keeps active capital deployed and exits queued.
- A void returns cell principal and no execution fee.
- A keeper outage stops automation but not permissionless allocation, harvest, exit processing, cancellation, or claim.
- A Supabase outage does not affect ownership or recovery.
- A clean browser restores pool-share and exit-receipt notes from encrypted output history.

## Testnet release gates

1. At least 20 LPs deposit different amounts into one pool.
2. Deposits before, during, and after active market exposure mint non-dilutive shares.
3. Direct donations cannot change either NAV or minted shares.
4. FIFO allocation cannot be reordered by a keeper.
5. Market, group, deployed, active-count, duration, and idle caps fail closed.
6. At least 8 simultaneous market cells cover crypto, FX, and commodities risk groups.
7. YES, NO, and VOID terminal outcomes reconcile exact pool NAV.
8. One market loss cannot spend another cell.
9. Immediate redemption, rate-limited redemption, queued exit, cancellation, claim, and terminal harvest all pass.
10. Private pool ownership never appears in Supabase or public wallet fields.
11. A service restart and clean browser restore all private pool actions.
12. Full Rust, circuit, service, browser, and deployed testnet tests pass.
13. Cargo verification ends with `cargo clean` and no target directory.

## Mainnet prohibition

Mainnet remains blocked until the pool, market cells, NAV policy, queue, risk caps, correlated loss model, contracts, circuits, and service automation receive independent review and a public testnet period exercises profit, loss, void, delayed resolution, run conditions, and keeper failure.
