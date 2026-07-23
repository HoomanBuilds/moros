# Permissionless liquidity and private batch pricing specification

## Status

Design for implementation and testnet validation. This specification extends the shared shielded collateral design in `docs/specs/2026-07-22-shielded-collateral-privacy.md`.

It does not claim that the current deployed contracts provide LP shares, live LP NAV, safe active withdrawals, uniform private batch pricing, or creator-free market funding.

## Decisions

- A market creator proposes a market. The creator does not have to provide USDC.
- Anyone may fund an eligible market, including Moros, individual users, and professional liquidity providers.
- LP capital is separate from bettor collateral and separate from protocol revenue.
- Each market has isolated LP accounting. A loss in one market cannot consume another market's backing.
- LPs receive proportional vault shares. Their final USDC value rises or falls with market-maker profit, loss, and the LP share of trading fees.
- An LP may request an exit at any time.
- A request is not a promise of immediate USDC while the capital secures an open market. Before activation it is immediately refundable. After activation it is filled by replacement liquidity or after sufficient capital becomes safely releasable. Resolution makes the final NAV exact.
- The fixed LMSR liquidity parameter `b` is frozen at activation.
- Active deposits do not mint new LP shares against a manipulable internal price. New LP capital may replace an exiting LP without removing market backing.
- Every executed private batch uses an order-independent uniform price per side.
- One pending order does not move the public price. The price moves atomically when a valid batch executes.
- The first implementation uses fixed-lot private batches and a public protocol slippage ceiling. Custom private limit prices remain disabled until a reviewed proof or MPC design can enforce them without revealing individual sides.
- Trading fees apply only to executed positions. They do not apply to LP deposits, LP withdrawals, failed orders, pending refunds, principal refunds, or voided markets.

## Why the Tethra model is relevant but not identical

Tethra mints vault shares against an underlying DeepBook PLP position. Its share value changes with the underlying vault NAV. A withdrawal burns shares and requests the corresponding underlying value.

The important safety condition is in the underlying DeepBook Predict contract. A withdrawal is accepted only when the requested amount is no greater than vault balance minus maximum payout, and a withdrawal rate limiter may restrict it further. Tethra also documents that a withdrawal can fail when available coverage is exhausted.

Moros should reuse these ideas:

- Proportional LP shares.
- Deposit and withdrawal previews from contract state.
- Virtual share offsets or equivalent first-deposit protection.
- Deposit caps.
- A separate cost basis.
- Profit-only economics.
- A public available-withdrawal value.
- Onchain maximum-payout checks.
- Rate limits and queued exits.

Moros cannot copy the immediate-withdrawal behavior blindly. DeepBook has a shared risk engine, mark-to-market liability, exposure caps, and a native PLP burn path. The current Moros LMSR has a fixed `b`, isolated markets, and no independent probability mark for arbitrary events.

For an open fixed-`b` LMSR, the initial reserve is part of the promise that future valid trades remain solvent. Removing it can leave current claims covered while making the next valid trade unsafe. A safe design must either keep the reserve, replace the exiting LP, reduce future trading capacity, or wait until trading closes.

## Research basis

- LMSR cost and bounded-loss analysis: https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf
- DeepBook Predict supply and withdrawal checks at the Tethra-pinned commit: https://raw.githubusercontent.com/MystenLabs/deepbookv3/1159d79af33c70e09e406310e1d8f067832ede9d/packages/predict/sources/predict.move
- Gnosis fixed-product market-maker LP shares, fee pool, add funding, and remove funding: https://github.com/gnosis/conditional-tokens-market-makers/blob/master/contracts/FixedProductMarketMaker.sol
- Polymarket inventory funding with complete YES and NO sets: https://docs.polymarket.com/market-makers/inventory
- Polymarket taker fee curve and category policies: https://docs.polymarket.com/trading/fees
- Polymarket maker rebates funded by taker fees: https://docs.polymarket.com/market-makers/maker-rebates
- CoW fair combinatorial batch auctions and order-independent directed prices: https://docs.cow.fi/cow-protocol/concepts/introduction/fair-combinatorial-auction
- Frequent batch auction market-design research: https://econ.umd.edu/publication/high-frequency-trading-arms-race-frequent-batch-auctions-market-design-response-0

These systems are references, not drop-in designs. Polymarket is a CLOB, Gnosis uses conditional-token inventory, DeepBook uses an independent risk and pricing stack, and Moros uses a private LMSR flow.

## Actors

### Market creator

Defines the question, outcomes, evidence rules, resolver capability, close time, resolution time, funding deadline, liquidity tier, category, and metadata. The creator pays only normal Stellar transaction fees and any separately approved anti-spam requirement. The creator does not fund market-maker loss unless they voluntarily act as an LP.

### Liquidity provider

Deposits USDC into a market funding tranche and receives LP shares. The LP accepts bounded market-maker risk. Moros has no privileged LP class and may deposit through the same interface.

### Bettor

Spends a shielded USDC note to create a private fixed-lot order. The wallet, side, and actual execution charge are not published.

### Shared collateral vault

Holds bettor balance notes, order budgets, change liabilities, payout liabilities, and shielded fee notes. It is the sole batcher for private markets. It never treats LP capital as bettor backing.

### Market liquidity vault

Holds and accounts for the LP reserve for one market. It issues LP share notes, funds activation, receives terminal market-maker equity and the LP fee share, and processes LP exits.

### LMSR market

Stores immutable `b`, market quantities, collateral, resolution configuration, aggregate trade collateral, and resolution state. It exposes exact batch quotes, scenario liabilities, and terminal LP settlement.

### Factory and registry

Accepts supported proposals, records their immutable configuration, links a proposal to one liquidity vault, and activates a market only after oracle and funding gates pass.

### Committee, coordinator, and relayer

Validate private order proofs, form fixed-lot mixed batches, reveal only allowed aggregates, and submit proof-bound state transitions. They never custody bettor or LP USDC.

## Contract separation

The following balances must never be merged in accounting:

1. Bettor shielded balance liabilities.
2. Bettor pending order budgets.
3. Aggregate LMSR trade collateral owned by the bettor vault.
4. LP underwriting reserve.
5. Refundable trade-fee escrow.
6. Vested LP fees.
7. Vested protocol fees.
8. Relayer and keeper service budgets.
9. A bounded protocol rounding reserve.

One SAC token balance may physically contain more than one class only when the contract stores exact class totals and every transition proves their conservation. A simpler separate contract balance is preferred for LP underwriting.

## Market lifecycle

### Proposed

- The factory validates an approved market template, category, resolver capability, evidence policy, time bounds, fee cap, liquidity tier, and collateral SAC.
- Unsupported categories fail before funding.
- The proposal is public and receives a deterministic proposal ID.
- No LMSR trade is possible.
- No creator USDC transfer is required.

### Funding

- Anyone may contribute USDC before the funding deadline.
- Each accepted contribution creates an LP share note.
- Contributions are accepted only up to the public funding target.
- An overfilling transaction accepts the remaining amount and returns the rest atomically.
- The LP share supply and total funded USDC are public. Individual LP ownership and value may remain shielded.
- Before activation, an LP may burn shares for the same USDC amount, subject only to exact rounding.
- If the deadline passes below target, anyone may cancel the proposal and every LP may recover the full contribution.

### Ready

- Funding equals the target.
- Oracle capability and deployment hashes are rechecked.
- `b` is derived from the target using the reviewed fixed-point formula.
- The target covers the rounded-up initial LMSR loss bound and all required initialization reserves.
- No order is accepted until activation is atomic.

### Active

- The factory deploys and initializes the market, links the shared collateral vault as sole batcher, and transfers the LP reserve from the market liquidity vault.
- `b`, collateral, resolver, close time, fee policy, batch policy, and rules hash become immutable.
- LP share supply is frozen for direct minting.
- Anyone may submit replacement liquidity for an outstanding LP exit.
- Every batch must pass projected solvency and configured capacity checks.

### Closed

- New order commitments fail.
- The last privacy-safe batch window completes.
- Pending orders that cannot enter a valid mixed batch become privately refundable.
- The final accepted and included roots are sealed.
- LP exits remain queued unless replacement liquidity or separately proved releasable cash exists.

### Resolved

- The aggregate winning shares are redeemed once.
- User payout liabilities, fee amounts, and terminal LP equity become exact.
- LP share notes redeem pro rata for terminal equity.

### Voided

- Executed trade collateral returns to the shared bettor vault.
- Executed trade-fee escrow returns to bettors.
- LP underwriting reserve returns to the liquidity vault.
- LP shares redeem pro rata without a market loss or protocol trading fee.

### Finalized

- All aggregate user backing has returned to the shared vault.
- LP terminal equity has returned to the liquidity vault.
- Fee splits are vested.
- Only claim, refund, withdrawal, recovery, and TTL maintenance paths remain.

## LMSR funding

For a binary market:

`C(qY, qN) = b * ln(exp(qY / b) + exp(qN / b))`

At the initial state:

`C(0, 0) = b * ln(2)`

The funding target `F` must satisfy:

`F >= ceil_atomic(b * ln(2)) + initialization_reserves`

The factory derives the largest supported fixed-point `b` whose rounded-up bound fits `F`. It never rounds `b` upward beyond the funded reserve.

The market starts with `qY = 0` and `qN = 0`. The target is chosen from governance-capped liquidity tiers so a creator cannot request an unbounded treasury allocation.

Larger `b` means deeper liquidity and less price movement for a given order. It also requires more LP capital. Additional capital after activation does not silently change `b`.

## LP share accounting

### Funding-stage mint

There is no market P&L before activation. LP shares are minted from accepted USDC using exact atomic accounting and a virtual offset:

`shares_out = floor(deposit * (total_shares + virtual_shares) / (funded_assets + virtual_assets))`

The first normal deposit is effectively one share unit per USDC atomic unit. Direct SAC donations do not mint shares and cannot manipulate the accounting denominator.

### Scenario equity

For an active market:

- `A` is the USDC held by the LMSR market that belongs to LP reserve plus executed LMSR charges.
- `QY` is the atomic payout if YES wins.
- `QN` is the atomic payout if NO wins.
- `FY` is vested LP fee value outside user refund obligations.

The public scenario equity is:

`equity_if_yes = A - QY + FY`

`equity_if_no = A - QN + FY`

`equity_floor = min(equity_if_yes, equity_if_no)`

`equity_ceiling = max(equity_if_yes, equity_if_no)`

At resolution:

`terminal_equity = A - winning_payout + FY`

The per-share terminal value is:

`terminal_share_value = terminal_equity / total_lp_shares`

The contract uses integer formulas with an explicit rounding direction. Withdrawals round down. The last share redemption receives only the proved remaining LP balance after all higher-priority user liabilities are zero.

### What the UI may call NAV

Before resolution, Moros displays:

- LP principal.
- LP fee accrual.
- Equity if YES.
- Equity if NO.
- Worst-case equity.
- Estimated economic NAV only when its valuation source and timestamp are shown.
- Safely withdrawable now.
- Queued exit value.

The interface must not show one exact redeemable NAV for an unresolved market when no independent, manipulation-resistant valuation source exists.

### Profit and loss

LP market-maker profit or loss is the difference between terminal equity excluding LP fees and funded principal.

LP return includes:

- The LP share of vested trading fees.
- Positive terminal market-maker P&L.
- Negative terminal market-maker P&L.

LP loss is limited to the capital allocated to that isolated market. The protocol does not promise principal protection, a fixed yield, or guaranteed immediate liquidity.

## LP exit policy

### Before activation

The LP burns shares and receives the proportional funding-stage USDC immediately.

### While active

The LP may submit an exit request at any time. The request locks the selected LP shares so they cannot be sold or requested twice.

The request binds the share amount, minimum USDC accepted, expiry, and destination shielded key. This is a sale offer for the existing risk-bearing shares, not a protocol promise that the unresolved position has one exact fair value.

An active exit completes through one of these paths:

1. A replacement LP supplies the stated USDC and receives the same risk-bearing shares atomically.
2. A reviewed future contract path proves that capital is unallocated and removable without violating current payout coverage or minimum future batch capacity.
3. Trading closes and the market releases a proved safe amount.
4. The market resolves or voids and exact terminal NAV is available.

The first testnet implementation supports paths 1 and 4. It does not pretend that path 2 exists for the current fixed-`b` LMSR.

Replacement liquidity does not mint additional shares or change `b`. It changes the owner of existing shares while market backing stays in place. The replacement LP sees current scenario equity, fees, market state, and time to resolution before accepting the stated price.

The exit queue is FIFO within an identical price and share class. A cancellation restores the locked shares if no match has started. Partial fills update the remaining shares atomically.

### After resolution or void

The LP burns shares and receives:

`floor(shares_burned * remaining_lp_assets / remaining_lp_shares)`

No administrator, creator, frontend, or original funder is required.

### Portfolio vault gate

A diversified Moros LP vault may later hold LP shares across many isolated markets, similar to the way Tethra wraps an underlying PLP asset. It is not allowed to allocate capital until:

- Per-market LP accounting is complete.
- Correlated worst-case exposure is bounded.
- Unsupported user-created markets cannot receive vault capital.
- Active positions have a reviewed valuation policy.
- Deposits and withdrawals cannot exploit stale or manipulable marks.
- Idle-liquidity targets and a withdrawal rate limiter are tested.
- A run cannot make one market consume another market's required reserve.

## Fee policy

The new LP-backed private market uses an execution-time fee curve instead of the older positive-profit claim fee.

For a side with uniform execution price `p`, quantity `Q`, and fee parameter `r`:

`trade_fee = Q * r * p * (1 - p)`

This curve is symmetric between complementary outcomes and decreases near zero and one. It is calculated from the batch's authoritative uniform execution price, not a later spot price.

For a fixed lot `L`, the contract rounds the per-position fee up:

`fee_per_position = ceil_atomic(L * r * pY * (1 - pY))`

Because `pN = 1 - pY`, the same fixed lot pays the same fee on either hidden side. The aggregate escrow is:

`fee_escrow = batch_size * fee_per_position`

At normal resolution:

`lp_fee = floor(fee_escrow * lp_split_bps / 10_000)`

`protocol_fee = fee_escrow - lp_fee`

The protocol-side remainder rule is explicit and cannot draw from another accounting class.

Testnet evaluation defaults:

- `r = 0.04`.
- 50 percent of vested trade fees to LPs.
- 50 percent of vested trade fees to the Moros protocol treasury.
- Zero mandatory relayer, committee, and keeper service fee.

These are test parameters, not approved mainnet economics. The contract caps `r`, freezes it per market before activation, and freezes the LP and protocol split.

Rules:

- A fee is escrowed only when a batch executes.
- A resolved market vests the fee.
- A voided market returns the fee to the affected bettor liability pool.
- A failed or never-included order pays no trade fee.
- LP deposits and withdrawals pay no protocol fee.
- Principal refunds pay no protocol fee.
- A service fee, when later enabled, is a separate user-authorized amount for completed work.
- Rounding residue is not protocol revenue.

## Private frequent batch pricing

### Problem

The current public price changes only when the committee batch reaches the market contract. If the UI presents that price as immediately executable, a later user appears to receive an advantage from a stale quote.

Publishing a price movement for each submitted private order would reveal timing and may reveal direction or amount. Serial execution would also let order position inside a batch determine price.

### Required behavior

- Time is divided into short market epochs.
- An order binds to one market, one epoch, one pre-state hash, one lot size, one batch policy, and one expiry.
- Orders in the same batch are processed together.
- The batch has one uniform average execution price for YES and one for NO.
- The allocation is independent of arrival order, coordinator order, commitment ordering, and transaction ordering.
- The public spot price changes only in the same atomic transition that applies the batch.
- An order from a stale epoch cannot execute against a different state.

### Aumann-Shapley side prices

For pre-state `q = (qY, qN)` and aggregate batch `D = (dY, dN)`, define the incremental cost:

`M = C(q + D) - C(q)`

The uniform YES price is the average YES marginal price along the straight path from `q` to `q + D`:

`pY = integral from 0 to 1 of price_yes(q + tD) dt`

The uniform NO price is:

`pN = 1 - pY`

The side costs are:

`MY = dY * pY`

`MN = dN * pN`

In exact arithmetic:

`MY + MN = M`

For the binary LMSR, let:

`z0 = (qY - qN) / b`

`dz = (dY - dN) / b`

When `dz = 0`:

`pY = sigmoid(z0)`

Otherwise:

`pY = (softplus(z0 + dz) - softplus(z0)) / dz`

The implementation must use one reviewed fixed-point realization in the Rust contract, circuit fixtures, service code, and browser preview.

### Fixed-lot batches

The first private release accepts a public lot identifier and hides the side and charged USDC amount. Every position inside one batch has the same winning-share quantity.

For lot quantity `L`:

`nY = dY / L`

`nN = dN / L`

Both values must be positive integers and:

`nY + nN = batch_size`

The market converts the exact aggregate cost into atomic side totals `MY_atomic` and `MN_atomic` whose sum equals the exact atomic market charge:

1. Calculate high-precision `MY` and `MN`.
2. Convert each side down to a base atomic amount.
3. Compare the discarded fractional remainders.
4. Assign the remaining one or two aggregate atomic units by largest remainder, with a fixed YES tie break.
5. Reject the batch if the aggregate atomic gap is outside the proved rounding bound.

This rule is symmetric apart from the documented exact tie break and never depends on an order commitment.

Each YES position is charged:

`cY = floor(MY_atomic / nY)`

Each NO position is charged:

`cN = floor(MN_atomic / nN)`

The exact reconciliation reserve is:

`rounding = MY_atomic - nY * cY + MN_atomic - nN * cN`

The rounding value is public, bounded by fewer than `batch_size` USDC atomic units, and funded from a dedicated protocol rounding reserve. It is not taken from another bettor or LP and is not counted as revenue.

This fixed-lot rule lets a user later prove their correct private charge from their hidden side without giving any batch prover all individual plaintext orders.

### Slippage protection

The first release uses a market-wide maximum adverse movement per epoch:

- The user sees the indicative pre-state price.
- The order proof binds the approved movement ceiling and epoch.
- For ceiling `delta`, a proposed batch must satisfy `pY <= pre_pY + delta` and `pN <= pre_pN + delta`.
- The committee may form smaller valid fixed-lot groups, but it may not process a one-position or one-sided group.
- An order that cannot execute before expiry becomes privately refundable.

This provides a deterministic price bound without revealing a custom side-specific limit.

Custom private limit orders require one of these reviewed designs:

- A second user consent proof after the batch price is known.
- A distributed proof or MPC that checks encrypted per-order limits.
- Another construction that proves every limit without revealing side or amount.

The feature remains disabled until one construction passes privacy, liveness, and load tests.

### What happens after one bet

If one user submits an order:

- The order status becomes pending.
- The public price does not change because no trade executed.
- The UI shows the indicative price, epoch countdown, total pending count, and refund deadline.
- It does not publish pending YES or NO counts.

When a valid mixed batch executes:

- Every included user receives the appropriate uniform side price.
- The exact aggregate cost and fee are applied.
- The new spot price and state version become public.
- The next epoch uses that confirmed state.

A second user does not receive a stale serial fill. If they join the same epoch, they share the batch pricing rule. If they join later, their proof binds the new confirmed state.

## Private order and claim lifecycle

### Order

The private order proof binds:

- Input shielded balance notes and nullifiers.
- Market and vault domains.
- Epoch and pre-state hash.
- Public lot identifier.
- Private side.
- Position secret.
- Maximum protocol movement policy.
- Position budget.
- Trade-fee cap.
- Refund deadline.
- Ciphertexts that encode the same hidden side and lot.

The position budget must cover one USDC per winning share, the maximum trade fee, and any separately authorized service fee.

### Batch

The batch statement binds:

- Included commitment root.
- Exact commitment count.
- Aggregate YES and NO quantities.
- `nY`, `nN`, `pY`, `pN`, `MY_atomic`, `MN_atomic`, `cY`, `cN`, and rounding reserve.
- Pre-state and post-state hashes.
- Epoch and expiry.
- Fee totals and escrow.
- Committee DKG epoch and signer set.
- Vault and market contract IDs.

### Change recovery after execution

After the batch confirms, the user may prove membership with the hidden side and recover:

`change = position_budget - side_charge - side_trade_fee - earned_service_fee`

The proof consumes an execution-change nullifier and creates a new shielded balance note. The position's future resolution nullifier remains private and unspent.

This prevents unused budget from remaining locked until resolution.

### Resolution claim

After normal resolution:

- A winning position creates a shielded balance note for the fixed winning credit.
- A losing position creates no winning credit.
- The position nullifier is consumed exactly once.
- Trade fees are already escrowed and are not charged again.

After void:

- The position budget, including the escrowed trade fee, returns under the void-refund proof.
- The execution-change accounting ensures value is returned exactly once.

## LP privacy

The total funding target, funded amount, LP share supply, market reserve, and solvency values are public.

An individual LP may fund from a shared shielded USDC balance:

1. A proof spends a shielded balance note.
2. The shared vault transfers aggregate USDC to the market liquidity vault.
3. A private LP share note is created.
4. No public wallet is linked to the target market by contract fields.

An LP exit returns USDC to a new shielded balance note. A later public withdrawal reveals its recipient and amount.

Privacy still depends on timing, deposit denominations, other users, relayer behavior, and the anonymity set. Moros does not promise that a unique public deposit followed immediately by a unique LP conversion is unlinkable by timing analysis.

## Solvency invariants

1. Bettor liabilities never include LP capital as an available balance.
2. LP claims never include bettor balance-note backing.
3. Every active market starts with its rounded-up LMSR loss bound funded.
4. Every batch transfers exactly the market charge plus only the explicit bounded rounding contribution.
5. For both possible outcomes, market assets cover aggregate winning-share payout before any LP terminal withdrawal.
6. Trade-fee escrow is refundable on void and cannot be withdrawn early by LPs or the treasury.
7. Vested LP fees cannot be used to cover bettor claims.
8. A market loss cannot consume another market's liquidity.
9. LP share minting cannot use a price derived from a state a trader can cheaply manipulate.
10. A replacement exit changes LP ownership without reducing market backing.
11. No exit request can be matched, cancelled, or claimed twice.
12. `b` never changes after activation.
13. One batch cannot overwrite the allocation data of another batch.
14. Price, cost, fee, and share rounding directions match across every component.
15. No protocol or LP fee is collected from a void, failed order, or principal refund.

## Edge cases

### Funding never completes

The proposal expires and every LP receives a full proportional refund. The market never activates.

### Creator disappears

Funding, activation, close, resolution, void, refund, and LP redemption remain permissionless.

### Moros funds a market

Moros receives ordinary LP shares and has no priority claim, custom fee, or withdrawal privilege.

### Only one side submits orders

No batch executes. Orders become privately refundable at their deadlines. No price changes and no trade fee vests.

### Only one order exists

The order remains pending and then becomes refundable. The UI must never label it filled.

### LPs request a run

Funding-stage exits execute. Active exits queue. Market backing cannot be drained. New proposals may remain unfunded and new bets may pause if capacity policy fails.

### A replacement LP never arrives

The exiting LP retains the queued claim and receives exact terminal value after resolution or void.

### Oracle is delayed

LP capital remains at risk and queued. The resolver recovery deadline leads to the tested void path.

### Market voids after batches

User trade collateral and trade fees return to the bettor vault. LP principal returns to the liquidity vault. No platform fee vests.

### Fee or rounding reserve is empty

The batch fails before consuming order nullifiers. Users can retry or refund.

### Committee fails

No batch executes. Pending users retain a proof-based refund path. LP accounting does not change.

### Stale frontend quote

The epoch or pre-state binding fails. The order is not silently repriced into another state.

### Concurrent batches

Only one transition from a pre-state version succeeds. The losing submission has no partial nullifier, fee, or market effect.

### USDC is frozen or unavailable

New activity pauses. Claims remain recorded, but the UI must state that Circle or network controls can block an actual SAC transfer.

## UI requirements

### Market creation

- Do not ask the creator for LMSR subsidy USDC.
- Show the selected liquidity tier and expected price depth.
- Create the public proposal first.
- Route to a funding page with status, deadline, funded amount, and activation condition.
- Explain that Moros may fund eligible markets but does not guarantee funding.

### Liquidity page

- Deposit USDC.
- Show LP shares received.
- Show principal, fee accrual, YES scenario equity, NO scenario equity, worst-case equity, and final resolved value.
- Show `Withdrawable now`, `Queued`, and `At risk`.
- Use `Request exit` while active, not `Withdraw now`.
- Explain that replacement liquidity or resolution completes an active exit.
- Show that LP capital can lose value.
- Do not advertise APY before measured historical returns exist.

### Bet panel

- Label the displayed odds `Indicative until next batch`.
- Show the fixed lot, maximum adverse movement, epoch countdown, and refund deadline.
- Show `Pending`, `Included`, `Executed`, `Change ready`, `Resolved`, and `Refundable` as separate states.
- Do not update odds when an order is only pending.
- Update odds only from a confirmed onchain batch.
- Do not show an estimated payout based on a price the order is not guaranteed to receive.

### Market page

- Show total LP reserve and public solvency values.
- Show the last confirmed batch time and state version.
- Show aggregate pending count without side counts.
- Explain sparse-activity privacy and refund behavior.

## Testnet acceptance

The design is testnet ready only when:

1. A creator with no USDC proposes an eligible market.
2. At least three unrelated LPs fund it, including one Moros-controlled test account through the same public method.
3. One LP exits before activation at exact principal.
4. Funding reaches the target and activation is atomic.
5. `b` matches the funded loss bound under differential math tests.
6. An active LP exit queues without reducing market backing.
7. A replacement LP fills a partial and full queued exit.
8. A queued exit survives browser, service, and keeper restarts.
9. YES and NO terminal cases produce exact scenario accounting.
10. VOID returns LP principal and refunds bettor trade fees.
11. Fixed-lot batches produce exact order-independent side prices.
12. Reordering commitments, transactions, or coordinator input does not change any user's charge.
13. The exact rounding reserve is below the proved batch bound.
14. A lone order and one-sided orders never execute and become privately refundable.
15. The price changes only after a confirmed batch.
16. A stale epoch, excessive movement, invalid aggregate, or wrong state version fails atomically.
17. Users recover unused order budget after execution without revealing side.
18. Protocol and LP fee totals reconcile exactly.
19. Stateful tests preserve user and LP solvency across deposits, exits, batches, closes, resolves, voids, refunds, and claims.
20. UI copy distinguishes indicative price, executed price, estimated LP value, safe withdrawal, and queued exit.

## Mainnet gate

Mainnet remains blocked until:

- The LMSR and Aumann-Shapley fixed-point implementation receives independent review.
- The LP contracts, private circuits, and cross-contract accounting receive independent audits.
- Every active-exit statement is honest under worst-case liquidity.
- Fee and LP economics pass simulation under balanced, one-sided, manipulated, sparse, and oracle-delay scenarios.
- At least one public testnet period exercises full LP profit, loss, replacement exit, delayed resolution, and void behavior.
- Mainnet USDC, factory, vault, market, resolver, proof keys, committee, relayers, keepers, and UI configuration are frozen and verified together.
- A diversified portfolio vault, if included, separately passes correlated-loss, stale-NAV, run, and manipulation testing.
