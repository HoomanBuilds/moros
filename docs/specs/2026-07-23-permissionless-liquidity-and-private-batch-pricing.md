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
- Batch membership is the complete bounded set accepted onchain for one market epoch. A coordinator cannot choose a favorable subset after learning aggregate directions.
- One pending order does not move the public price. The price moves atomically when a valid batch executes.
- The first implementation uses fixed-lot private batches and a public protocol slippage ceiling. Custom private limit prices remain disabled until a reviewed proof or MPC design can enforce them without revealing individual sides.
- An executed batch must contain at least eight positions and at least two positions on each side. If measured proof limits cannot support that floor, the private batch release is blocked rather than silently using a weaker two-position fallback.
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

The caller who proposes or activates pays the Stellar network fee for that transaction unless an explicit protocol operations budget sponsors it. Deployment and keeper XLM can never be taken from LP USDC principal or bettor collateral.

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
- The LP share supply and total funded USDC are public. LP note ownership remains shielded, but a first-release funding transaction's market, timing, and aggregate funded delta are public.
- Before activation, an LP may burn shares for the same USDC amount, subject only to exact rounding.
- If the deadline passes below target, anyone may cancel the proposal and every LP may recover the full contribution.
- Funding, withdrawal, cancellation, and activation compare and update one proposal state version atomically. A withdrawal that wins the race returns the proposal to `Funding`; an activation that wins freezes funding-stage exits before moving reserve.
- The funding deadline and activation cutoff leave a configured minimum open-trading window before market close. A fully funded proposal that misses the activation cutoff becomes permissionlessly cancellable.

### Ready

- Funding equals the target.
- Oracle capability and deployment hashes are rechecked.
- `b` is derived from the target using the reviewed fixed-point formula.
- The target covers the rounded-up initial LMSR loss bound and all required initialization reserves.
- No order is accepted until activation is atomic.
- If the collateral, oracle capability, template, or timing checks no longer pass, activation fails without moving reserve and anyone can move the proposal to its refund state after the defined recovery condition.

### Active

- The factory deploys and initializes the market, links the shared collateral vault as sole batcher, and transfers the LP reserve from the market liquidity vault.
- `b`, collateral, resolver, close time, fee policy, batch policy, and rules hash become immutable.
- LP share supply is frozen for direct minting.
- Anyone may submit replacement liquidity for an outstanding LP exit.
- Every batch must pass projected solvency and configured capacity checks.
- Active instances cannot change code, resolver, collateral, fee, batch policy, or custody linkage in place. A future migration must preserve exits and user claims through a separately reviewed path.

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

`virtual_assets` and `virtual_shares` are equal, immutable calculation constants. They are not owned assets, do not receive fees, and never create a redeemable claim. The first normal deposit is one share unit per USDC atomic unit. Direct SAC donations do not mint shares and cannot manipulate the accounting denominator.

Funding-stage burns use tracked funded assets, not the raw token balance. The last funding-stage burn receives the remaining tracked funded assets, and total share supply can reach zero only when tracked funded assets also reach zero. Activation requires positive share supply and the exact target.

Only the allowlisted Stellar USDC SAC is accepted. Its address and decimals are frozen by the factory. Every transfer validates the exact accounted amount, rejects negative or zero values, and grants no standing token allowance. Direct donations and issuer-side balance changes are recorded as unallocated differences and never silently become shares, fees, or solvency credit.

### Scenario equity

For an active market:

- `A` is the USDC held by the LMSR market that belongs to LP reserve plus executed LMSR charges.
- `QY` is the atomic payout if YES wins.
- `QN` is the atomic payout if NO wins.
- `FL` is the conditional LP share of distributable fee escrow for a normal resolution. It is zero under VOID and remains unvested until a normal result is final.

The public scenario equity is:

`equity_if_yes = A - QY + FL`

`equity_if_no = A - QN + FL`

`equity_floor = min(equity_if_yes, equity_if_no)`

`equity_ceiling = max(equity_if_yes, equity_if_no)`

At resolution:

`terminal_equity = A - winning_payout + vested_FL`

The per-share terminal value is:

`terminal_share_value = terminal_equity / total_lp_shares`

The contract uses integer formulas with an explicit rounding direction. Withdrawals round down. The last share redemption receives only the proved remaining LP balance after all higher-priority user liabilities are zero.

### What the UI may call NAV

Before resolution, Moros displays:

- LP principal.
- Conditional unvested LP fee accrual.
- Equity if YES.
- Equity if NO.
- Worst-case equity.
- Estimated economic NAV only when its valuation source and timestamp are shown.
- Safely withdrawable now.
- Queued exit value.

The interface must not show one exact redeemable NAV for an unresolved market when no independent, manipulation-resistant valuation source exists.

Conditional fee accrual is excluded from `Safely withdrawable now`, disappears under VOID, and cannot be withdrawn before normal resolution.

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

The replacement LP acceptance binds the exit terms, current market state version, maximum state age, scenario equity values, fee totals, and expiry. A batch, close, resolution, cancellation, or prior match that changes those bound fields makes the match fail atomically. The replacement LP must submit a fresh acceptance instead of receiving a silently changed risk position.

An active exit completes through one of these paths:

1. A replacement LP supplies the stated USDC and receives the same risk-bearing shares atomically.
2. A reviewed future contract path proves that capital is unallocated and removable without violating current payout coverage or minimum future batch capacity.
3. Trading closes and the market releases a proved safe amount.
4. The market resolves or voids and exact terminal NAV is available.

The first testnet implementation supports paths 1 and 4. It does not pretend that path 2 exists for the current fixed-`b` LMSR.

Replacement liquidity does not mint additional shares or change `b`. It changes the owner of existing shares while market backing stays in place. The replacement LP sees current scenario equity, fees, market state, and time to resolution before accepting the stated price.

The purchase USDC moves from the replacement LP's shielded balance to the exiting LP's shielded balance. It does not enter or leave the market reserve. Accrued and future LP fee rights, market-maker profit, and market-maker loss follow the transferred shares to their new owner. The sale price is the only value retained by the seller for the transferred portion.

Every first-testnet offer is a full-fill lot. A seller may offer part of one LP note and retain the rest as private LP change, but a buyer must fill that offered lot completely. A cancellation spends the seller's private exit receipt and restores the locked shares while the offer remains open.

The first testnet matching venue exposes an exit lot, ask, expiry, payment-note template, and market state to prospective replacement LPs. It must not describe the offer itself as fully private. Shielded ownership prevents a public wallet link, but multiple active offers using the same shielded recipient keys may be linkable to one another, and a unique request can reveal economic metadata through timing.

Exit intents and their remaining fill state are ledger-reconstructable. The matching service is only discovery infrastructure. Any replacement LP may submit a valid state-bound acceptance directly, so one matcher cannot block a sale that already has a willing counterparty.

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

`rounding_reimbursement = batch_rounding_contribution`

`distributable_fee = fee_escrow - rounding_reimbursement`

`lp_fee = floor(distributable_fee * lp_split_bps / 10_000)`

`protocol_fee = distributable_fee - lp_fee`

Every accepted batch requires `fee_escrow >= rounding_reimbursement`. The temporary protocol rounding contribution is repaid first on normal resolution. On VOID it is recovered from the returned market charge. This prevents repeated balanced self-trading from draining the rounding reserve. The protocol-side fee remainder rule is explicit and cannot draw from another accounting class.

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
- LP fee entitlement follows the current LP share owner at terminal settlement. An active share seller must price already accrued but unvested fee rights into the secondary sale.

## Private frequent batch pricing

### Problem

The current public price changes only when the committee batch reaches the market contract. If the UI presents that price as immediately executable, a later user appears to receive an advantage from a stale quote.

Publishing a price movement for each submitted private order would reveal timing and may reveal direction or amount. Serial execution would also let order position inside a batch determine price.

### Required behavior

- Time is divided into short market epochs.
- An order binds to one market, one epoch, one pre-state hash, one lot size, one batch policy, and one expiry.
- Each market has only one accepting epoch at a time. Its onchain states are `Collecting`, `Sealed`, and either `Executed` or `Refundable`.
- Order acceptance assigns a monotonic onchain queue sequence before any aggregate direction is decrypted.
- The first release enables one configured lot per market epoch and caps the epoch queue at the measured maximum batch size. An order submitted after capacity is reached fails without consuming its input notes.
- Orders in the same batch are processed together.
- The batch has one uniform average execution price for YES and one for NO.
- For a fixed accepted set, price and charge allocation are independent of arrival order, coordinator order, commitment ordering, and transaction ordering. Capacity admission itself follows the public onchain acceptance order.
- The eligible set is every unexpired and unrefunded commitment accepted for that market epoch. The batch proof demonstrates set completeness and cannot skip, substitute, or reorder an accepted order.
- The complete set either executes together or becomes refundable. The first release does not choose a favorable subset after decrypting aggregate direction.
- Any caller seals the accepted root and count at the ledger-time cutoff. No later commitment can enter that sealed root.
- The next epoch cannot accept orders until the sealed epoch executes against its bound state or becomes refundable. It then binds the latest confirmed market state.
- Orders accepted after the epoch cutoff cannot enter that epoch. Orders that miss their bound epoch become refundable and must be reproved for a later state.
- An accepted first-release order cannot be cancelled during its short bound epoch. It either executes with the complete valid set or becomes refundable at its deadline. This prevents cancellation races from changing the hidden eligible set after acceptance.
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

The rounding reserve is a temporary bridge, not a subsidy. Each batch records its contribution as a receivable. Normal resolution repays it from vested fee escrow before the LP and protocol split. VOID repays it from the returned market charge. A batch fails before nullifier consumption if its fee escrow cannot cover the contribution or the reserve cannot advance it.

The minimum batch size is eight, each public side count is at least two, and the maximum size is fixed from proof and Soroban resource benchmarks. The minimum is a floor for public-observer privacy, not protection against a coalition that knows all other orders. No short final batch bypass exists. A final set below the minimum or with fewer than two positions on either side becomes refundable.

### Slippage protection

The first release uses a market-wide maximum adverse movement per epoch:

- The user sees the indicative pre-state price.
- The order proof binds the approved movement ceiling and epoch.
- For ceiling `delta`, a proposed batch must satisfy `pY <= pre_pY + delta` and `pN <= pre_pN + delta`.
- The movement ceiling and every price input use contract state, not an indexer or frontend cache.
- The complete epoch set may execute only when it satisfies the configured minimum and maximum batch sizes, the two-per-side floor, and the movement ceiling.
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

At market close, the current collecting epoch seals no later than `close_time`. Its complete set may execute during the bounded finalization window only if all normal privacy, movement, proof, and solvency rules pass. Otherwise it becomes refundable. Resolution cannot bypass sealing, execution, or refund eligibility for that final set.

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
- First and last onchain acceptance sequences, exact queue count, and proof that the complete eligible epoch set is included.
- Aggregate YES and NO quantities.
- `nY`, `nN`, `pY`, `pN`, `MY_atomic`, `MN_atomic`, `cY`, `cN`, and rounding reserve.
- Pre-state and post-state hashes.
- Epoch and expiry.
- Fee totals and escrow.
- Committee DKG epoch and signer set.
- The homomorphic ciphertext sum, public DKG verification-share commitments, and a verifiable aggregate-decryption proof.
- Vault and market contract IDs.

Each order proof is verified when the order is accepted, and its fixed-length ciphertext and commitment become durably reconstructable. The contract assigns its queue sequence in that same atomic acceptance. The batch proof must link the exact accepted ciphertext set to its homomorphic sum. Threshold signatures authenticate participation and liveness, but they are not enough for accounting soundness. The contract accepts a claimed aggregate only when the selected encryption scheme's proof verifies that the aggregate ciphertext was decrypted correctly against the public DKG transcript.

Every ciphertext must have a canonical encoding, valid curve and subgroup membership, a non-identity component, a nonzero randomness witness, and the exact committee key epoch. A key rotation cannot strand or reinterpret pending orders. They must execute under their bound epoch or reach the existing refund path.

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

The total funding target, funded amount, every first-release aggregate funding delta, LP share supply, market reserve, and solvency values are public.

An individual LP may fund from a shared shielded USDC balance:

1. A proof spends a shielded balance note.
2. The shared vault transfers the accepted USDC to the market liquidity vault, which exposes the market and aggregate funding delta but not a funding wallet.
3. A private LP share note is created.
4. No public wallet is linked to the target market by contract fields.

An LP exit returns USDC to a new shielded balance note. A later public withdrawal reveals its recipient and amount.

Privacy still depends on timing, fixed funding lots or future funding batches, deposit denominations, other users, relayer behavior, and the anonymity set. The first testnet does not hide an individual funding delta when only one conversion funds the market in that transaction. Moros does not promise that a unique public deposit followed immediately by a unique LP conversion is unlinkable by timing analysis.

Active exit ownership remains shielded, but the matching service may learn the market, share lot, ask, and timing. Public aggregate queue changes can identify a unique exit economically even when no wallet address appears. Cross-request batching or fixed exit lots may improve this later, but the first testnet must state the limit.

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
16. Every active exit match is bound to one exact market state and transfers existing shares without changing reserve.
17. Funding withdrawal, cancellation, and activation cannot succeed from the same proposal state version.
18. Every rounding contribution is repaid exactly once from normal-resolution fee escrow or VOID market return.
19. A batch contains the complete eligible epoch set and no coordinator-selected omission.
20. An accepted aggregate is linked to the accepted ciphertexts by verifiable aggregation and threshold-decryption correctness, not committee signatures alone.

## Edge cases

### Funding never completes

The proposal expires and every LP receives a full proportional refund. The market never activates.

### Creator disappears

Funding, activation, close, resolution, void, refund, and LP redemption remain permissionless.

### Moros funds a market

Moros receives ordinary LP shares and has no priority claim, custom fee, or withdrawal privilege.

### Capability changes before activation

If the oracle, collateral, template, or timing capability becomes invalid, activation fails without moving reserve. After the specified recovery condition, anyone can cancel and every LP can recover tracked funded assets.

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

### Self-crossing or wash batches

Buying complementary fixed lots cannot create a complete-set profit from LMSR allocation. Trade fees, exact rounding reimbursement, and protocol fee share are included in the simulation. The release blocks any parameter set where repeated self-crossing, LP fee recycling, or rounding behavior has positive risk-free expected value.

### Committee fails

No batch executes. Pending users retain a proof-based refund path. LP accounting does not change.

### Stale frontend quote

The epoch or pre-state binding fails. The order is not silently repriced into another state.

### Concurrent batches

Only one transition from a pre-state version succeeds. The losing submission has no partial nullifier, fee, or market effect.

### Coordinator omits or reorders orders

The complete-set proof fails. Another coordinator can reconstruct the accepted ciphertext queue and submit the only valid eligible set. If no one submits before the deadline, every affected order keeps its shielded refund path.

### Queue-filling attack

An attacker may lock enough valid private budgets to fill an epoch with a set that cannot meet the side floor or movement limit. The complete set then refunds, so funds and prices remain safe but liveness is degraded. The testnet measures this attack with per-market queue caps and proof-of-funded-order admission. No mainnet claim of censorship resistance is allowed until the admission-cost and anti-grief policy is independently reviewed.

### Committee key rotates

Pending orders remain bound to their original DKG epoch. Rotation cannot change their ciphertext interpretation, and it cannot block the deadline refund. A migration is permitted only with a separately verified re-encryption or decryption proof.

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
- Show principal, conditional unvested fee accrual, YES scenario equity, NO scenario equity, worst-case equity, and final resolved value.
- Show `Withdrawable now`, `Queued`, and `At risk`.
- Use `Request exit` while active, not `Withdraw now`.
- Explain that replacement liquidity or resolution completes an active exit.
- Show the exact state timestamp used by a replacement LP and require reconfirmation when the market state changes.
- State which exit fields are visible to the matching service and which wallet linkage remains shielded.
- Show that LP capital can lose value.
- Do not advertise APY before measured historical returns exist.

### Bet panel

- Label the displayed odds `Indicative until next batch`.
- Show the fixed lot, maximum adverse movement, epoch countdown, and refund deadline.
- Show the minimum batch size, the two-per-side rule, and that insufficient activity leads to a refund rather than a weak short batch.
- Explain before confirmation that an accepted order cannot be cancelled during its short epoch and that a full queue rejects later orders without consuming their notes.
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
21. Funding withdrawal, cancellation, and activation races produce exactly one valid state transition.
22. Every active exit acceptance fails after a bound state change and succeeds only after explicit reconfirmation.
23. Every batch contains at least eight positions and at least two positions per side; smaller final sets refund.
24. Coordinator omission, reordering, and alternative-subset attempts fail the complete-set proof.
25. A false aggregate with valid committee signatures fails the verifiable aggregate-decryption check.
26. DKG rotation, malformed ciphertexts, subgroup violations, and old-epoch replay fail without stranding refunds.
27. Repeated complementary self-trading cannot extract rounding reserve or create positive risk-free value.
28. A queue-filling attacker cannot move price, consume another user's value, block deadline refunds, or make the next epoch use a stale state.

## Mainnet gate

Mainnet remains blocked until:

- The LMSR and Aumann-Shapley fixed-point implementation receives independent review.
- The LP contracts, private circuits, and cross-contract accounting receive independent audits.
- Every active-exit statement is honest under worst-case liquidity.
- Fee and LP economics pass simulation under balanced, one-sided, manipulated, sparse, and oracle-delay scenarios.
- Complete-set inclusion, verifiable aggregation, and verifiable threshold decryption receive independent cryptographic review.
- The selected batch floor and per-side floor are justified by a published privacy and performance measurement. They cannot be lowered through ordinary configuration.
- Queue-filling, spam, and repeated-refund economics have a reviewed admission-cost and anti-grief policy.
- At least one public testnet period exercises full LP profit, loss, replacement exit, delayed resolution, and void behavior.
- Mainnet USDC, factory, vault, market, resolver, proof keys, committee, relayers, keepers, and UI configuration are frozen and verified together.
- A diversified portfolio vault, if included, separately passes correlated-loss, stale-NAV, run, and manipulation testing.
