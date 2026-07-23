# Permissionless liquidity and private batch pricing implementation plan

## Goal

Implement `docs/specs/2026-07-23-permissionless-liquidity-and-private-batch-pricing.md` together with the shared shielded collateral plan.

The completed testnet flow must let a user create an eligible market without USDC, let anyone fund it as an LP, activate only after sufficient reserve exists, execute fair fixed-lot private batches, distribute fees and terminal market-maker P&L to LP shares, and preserve exact bettor and LP solvency.

## Working rules

- Use only `feat/platform-hardening`.
- Keep `main` unchanged until the user verifies the full testnet flow.
- Test each accounting transition before implementing it.
- Keep LP underwriting, bettor collateral, fee escrow, protocol revenue, and service budgets separate.
- Do not add active LP minting against an unreviewed internal NAV.
- Do not promise immediate USDC for capital that still secures an open market.
- Do not enable custom private limits until their enforcement preserves individual side privacy.
- Keep unsupported resolver categories unavailable.
- Use Stellar USDC as collateral. XLM is only for Stellar fees and account reserve.
- Preserve claim and refund paths for existing deployed markets.
- Run `cargo clean` after every Rust build or test session and verify no `target` directory remains before handoff.

## Delivery order

1. Freeze the existing economics and privacy baseline.
2. Prove the LP, LMSR, fee, batch-price, and rounding formulas in one reference model.
3. Add the market liquidity vault and proposal lifecycle.
4. Change market activation and terminal LP accounting.
5. Add uniform fixed-lot batch pricing and protocol movement bounds.
6. Extend private circuits and note recovery.
7. Wire services, indexers, keepers, and frontend.
8. Run multi-user and multi-LP stateful testnet verification.
9. Review before merging to `main`.

## Work package 0: Freeze the baseline

### Tests first

Record reproducible fixtures for:

- Creator-only `fund`.
- Creator USDC required by the current creation UI.
- Fixed `b` and current `b * ln(2)` subsidy.
- One global funding total with no LP shares.
- No resolved terminal subsidy recovery.
- Current batch order dependence or missing allocation proof.
- Public price remaining unchanged while an order is only pending.
- Bet UI using current spot odds without an execution-bound price.
- Existing 200 basis point positive-profit claim fee.
- Current one-sided and lone-order behavior.

### Work

- Add a machine-readable balance map for every contract that currently holds USDC.
- Record the exact owner of every current liability and residual.
- Record current testnet contract IDs and keep them isolated from the new capability.
- Add differential fixtures for `cost`, `price_yes`, `quote_batch`, and atomic conversion.
- Add a regression showing why a second user must not receive a serial stale-price fill.

### Gate

No contract change begins until the current full lifecycle reconciles or every existing mismatch is recorded as a blocking bug.

## Work package 1: Build the economics reference model

### Planned location

- `services/economics/`
- Shared JSON fixtures under `fixtures/economics/`

### Model requirements

Implement one exact integer reference for:

- Binary LMSR cost.
- Initial loss bound.
- Funding-target to `b` conversion.
- Aggregate batch charge.
- Aumann-Shapley YES and NO average prices.
- Atomic side-cost allocation.
- Fixed-lot per-position charge.
- Exact rounding-reserve contribution.
- Trade-fee curve.
- LP and protocol fee split.
- YES, NO, and VOID bettor liabilities.
- YES, NO, and VOID LP equity.
- Funding-stage share mint and burn.
- Replacement LP exit.
- Terminal LP share redemption.

### Required properties

- `side_cost_yes + side_cost_no = aggregate_market_charge`.
- Uniform price does not depend on commitment order.
- Fixed-lot user charges do not depend on arrival order.
- Rounding contribution is nonnegative and less than batch size atomic units.
- `equity_if_yes` and `equity_if_no` are nonnegative for every accepted state.
- Vested fees never include voided trade fees.
- Total system USDC is conserved across every transition.
- Larger `b` reduces price movement for the same fixed-lot batch.
- No state permits LP or protocol withdrawal from bettor backing.

### Simulation matrix

Run at least:

- Balanced orders.
- Highly one-sided order arrival.
- Mixed batches with every valid YES and NO count.
- Minimum and maximum lot sizes.
- Minimum and maximum funding tiers.
- Prices near zero, one half, and one.
- Exact and inexact atomic divisions.
- Repeated alternating batches.
- Repeated same-direction batches.
- LP profit on the less-purchased winning side.
- LP loss on the more-purchased winning side.
- VOID after several batches.
- Funding cancellation.
- Active exit request before and after large price movement.
- Committee and resolution delays.
- Fee rates from zero through the contract cap.

### Gate

Rust, circuit, TypeScript, and UI implementations must consume the same fixture corpus. A separate spreadsheet is not authoritative.

## Work package 2: Add market proposals and isolated liquidity vaults

### Planned location

- `contracts/market-factory/`
- `contracts/market-liquidity-vault/`
- Factory adapters under `services/`

### Contract tests first

- Create a proposal from a wallet with no USDC.
- Reject unsupported collateral, resolver, category, timing, fee, batch, and WASM capability.
- Accept LP funding from any address.
- Accept Moros treasury funding through the same method.
- Partially accept an overfilling deposit and return the rest.
- Mint exact LP shares.
- Reject zero deposits and zero-share mints.
- Ignore direct token donations in share accounting.
- Burn funding-stage shares for exact proportional USDC.
- Cancel an underfunded expired proposal permissionlessly.
- Refund every LP after cancellation.
- Reject activation below target.
- Recheck every capability during activation.
- Activate atomically at target.
- Roll back deployment, reserve transfer, and registration when any nested call fails.
- Freeze direct share minting after activation.
- Create and cancel an active exit request with share amount, minimum USDC, destination, and expiry without double use.
- Fill active exit shares at or above the stated minimum with replacement USDC atomically.
- Reject duplicate, stale, overfilled, and self-inconsistent exit matches.

### Contract work

- Store proposal status in bounded persistent keys.
- Bind proposal ID to creator, network, collateral, resolver, rules hash, timing, liquidity tier, fee policy, and batch policy.
- Derive the deployment salt from the immutable proposal.
- Track funded assets from accepted transfers, not raw SAC balance.
- Store total LP shares and private LP note root.
- Store exit intent nullifiers and remaining shares.
- Emit proposal, funded, unfunded, ready, activated, exit-requested, exit-matched, cancelled, and finalized events.
- Keep every time transition permissionless.
- Extend TTLs without unbounded map walks.

### Gate

A creator can reach `Funding` with no USDC, three LPs can fund the proposal, one LP can leave before activation, and another caller can activate the completed proposal.

## Work package 3: Redesign LMSR funding and terminal LP settlement

### Planned location

- `contracts/lmsr-market/`
- Factory and liquidity-vault contract clients

### Contract tests first

- Initialize only from the approved factory.
- Accept one exact activation reserve from the linked liquidity vault.
- Derive and freeze `b`.
- Reject direct later `b` changes.
- Expose `qY`, `qN`, market assets, payout-if-YES, payout-if-NO, and scenario LP equity.
- Reject a batch whose post-state is undercollateralized.
- Keep aggregate bettor batch collateral separate from the LP reserve total.
- Resolve YES and pay aggregate winning shares before releasing LP equity.
- Resolve NO with the equivalent ordering.
- VOID by returning aggregate batch collateral to the bettor vault and reserve to the LP vault.
- Release vested fees only after normal resolution.
- Prevent LP terminal settlement before the aggregate bettor redemption is complete.
- Prevent a second terminal settlement.
- Round LP withdrawals down and preserve the final residual exactly.
- Complete the market when the final LP share redeems.

### Contract work

- Replace creator-only funding with factory-linked liquidity-vault activation.
- Add explicit accounting totals for LP reserve, aggregate batch collateral, refundable fee escrow, and terminal LP equity.
- Remove creator as the terminal reserve beneficiary.
- Add permissionless `settle_liquidity`.
- Keep existing deployed instances on their original interface.
- Use capability-based routing instead of a user-facing version label.

### Gate

All YES, NO, and VOID sequences reconcile bettor assets, LP assets, fees, and market balance to zero unexplained atomic units.

## Work package 4: Implement uniform fixed-lot batch pricing

### Planned location

- `contracts/lmsr-market/src/math.rs`
- `contracts/shielded-collateral-vault/`
- `services/committee/`
- `services/economics/`

### Math tests first

- Compare Aumann-Shapley prices against high-precision reference values.
- Cover `dY = dN`.
- Cover small nonzero `dY - dN`.
- Cover price tails.
- Cover maximum fixed-point values.
- Prove monotonicity and price bounds.
- Prove side-cost sum against the existing LMSR aggregate cost.
- Prove the largest-remainder atomic side split and fixed YES tie break.
- Prove commitment-order independence for every permutation of four orders.
- Prove exact atomic reconciliation.
- Reject overflow, division by zero, invalid lot, invalid count, and invalid aggregate.

### Contract tests first

- Bind a batch to one pre-state version.
- Reject concurrent reuse of the same pre-state.
- Require both `nY > 0` and `nN > 0`.
- Require every included order to use the same lot.
- Require aggregate quantities to match lot times side counts.
- Enforce normal and final batch-size policies.
- Enforce the public maximum adverse movement.
- Transfer exact user charge plus exact rounding reserve.
- Fail before nullifier consumption when the rounding reserve is insufficient.
- Store one immutable batch execution record.
- Update spot price only after the batch succeeds.
- Reject a stale epoch or expired order.

### Service work

- Group orders by market, epoch, and lot.
- Never sort for economic advantage.
- Verify every encryption proof before aggregation.
- Produce aggregate quantities and threshold statements.
- Submit the exact reference-model batch fields.
- Persist idempotent state before submission.
- Recover cleanly when another worker wins the state race.
- Report only total pending count to public APIs.

### Gate

Every permutation of the same private fixed-lot order set produces identical side prices, per-side charges, fees, rounding, and post-state.

## Work package 5: Extend private circuits and notes

### Planned circuits

- Shielded balance to LP share.
- Funding-stage LP share redemption.
- Active LP exit request.
- Replacement LP share transfer.
- Terminal LP share redemption.
- Fixed-lot private order.
- Batch membership and private side charge.
- Executed-order change recovery.
- Winning position claim.
- Losing position finalization.
- VOID refund with fee return.

### Public-signal requirements

Every proof binds:

- Stellar network.
- USDC SAC.
- Contract address.
- Operation type.
- Root and accepted root window.
- Nullifiers.
- Expiry.
- Market or proposal domain.
- Fee and batch policy hash.

The order proof additionally binds:

- Epoch.
- Pre-state hash.
- Lot ID.
- Public movement ceiling.
- Encrypted hidden side.
- Position budget and fee cap inside the commitment.

The execution-change proof additionally binds:

- Batch allocation record.
- `cY` and `cN`.
- Hidden side.
- Exact side fee.
- Execution-change nullifier.

The terminal LP proof additionally binds:

- Final LP assets.
- Remaining LP shares.
- Exact shares burned.
- Withdrawal output.

### Negative tests

- Wrong network, asset, vault, market, proposal, batch, or epoch.
- Reused balance, order, change, position, exit, or LP nullifier.
- Wrong lot.
- Side outside the binary range.
- Position budget below maximum obligations.
- Charge or fee selected from the wrong side.
- Wrong replacement recipient.
- LP exit against the wrong market.
- Terminal LP redemption before finalization.
- VOID fee theft.
- Integer overflow and field aliasing.
- Malformed proof encoding.
- Proof from another verification key.

### Prover feasibility gate

Benchmark browser proving and Soroban verification before fixing tree depth or batch-root history. If the proof exceeds measured resource limits, split it only across atomically bound operations.

## Work package 6: Add fee escrow and revenue accounting

### Contract tests first

- Calculate the fee from the authoritative uniform price.
- Apply the same curve to complementary prices.
- Round one fixed-lot per-position fee identically for both hidden sides.
- Derive aggregate escrow from batch size without a hidden allocation remainder.
- Freeze rate and split before activation.
- Enforce the rate cap.
- Escrow fee on execution.
- Vest fee only on normal resolution.
- Return fee on VOID.
- Split vested value exactly between LP and protocol.
- Keep zero service fees on testnet.
- Reject any fee on failed, pending, refunded, or cancelled orders.
- Reject fee withdrawal from principal.

### Work

- Add per-market refundable fee escrow.
- Add vested LP fee balance.
- Add shielded protocol treasury fee notes.
- Add exact remainder policy to the reference fixtures.
- Display fee preview from the same fixed-point implementation.
- Log only aggregate public fee fields.

### Gate

The final state for normal resolution and VOID has no fee amount in the wrong owner class.

## Work package 7: Wire indexers, keepers, and recovery

### Indexer

- Index proposal and funding status.
- Index public LP share supply and market reserve.
- Index exit queue totals without exposing private LP ownership.
- Index batch epochs, state versions, uniform prices, charges, fees, and rounding.
- Index close, resolution, void, aggregate redemption, LP finalization, and claim readiness.
- Rebuild deterministically from chain history.

### Keepers

- Activate ready proposals.
- Close expired markets.
- Finalize batch roots.
- Resolve supported oracle markets.
- Trigger VOID recovery after the configured deadline.
- Redeem aggregate winning positions.
- Settle LP terminal equity.
- Extend required TTLs.

Every keeper action is permissionless and idempotent. At least two independently funded testnet keepers exercise each path.

### Recovery

- Restore private LP notes from viewing-key scans and durable checkpoints.
- Restore exit requests and remaining shares.
- Restore bettor change and position notes independently.
- Keep cloud backups opaque.
- Provide a CLI for funding refund, exit status, terminal LP redemption, pending-order refund, change recovery, and position claim.

## Work package 8: Build the user interface

### Market creation

- Remove creator subsidy and creator USDC balance gating.
- Submit a proposal before deployment.
- Show only supported market categories.
- Show liquidity tier, expected depth, funding target, and funding deadline.
- Link to the funding page.

### Funding page

- Show proposal rules and oracle capability.
- Show funded amount and target.
- Show the LP risk warning before confirmation.
- Preview LP shares.
- Support shielded LP funding.
- Show funding-stage withdrawal.
- Show active exit request and queue status.
- Show replacement-liquidity entry.
- Show YES scenario, NO scenario, worst-case, fees, and final resolved value.

### Bet panel

- Rename the current price to `Indicative price`.
- Show the next batch countdown.
- Show lot size and maximum adverse movement.
- Show total pending count without side counts.
- Preview both the best and worst allowed execution within the epoch policy.
- Separate `Order pending` from `Bet executed`.
- Show unused budget recovery after execution.
- Show refund time when a batch cannot form.

### Portfolio

- Add LP shares separately from bettor positions.
- Show funding, active, queued exit, resolved, and void states.
- Show market participation history from shielded local recovery without putting wallet history in a public database.
- Show claim and refund actions only when eligible.

### UI tests

- Creator with zero USDC.
- First LP, partial fund, final fund, and overfill.
- Funding cancellation and refund.
- Active exit queue and replacement match.
- LP profit, LP loss, and VOID.
- Lone order with no price movement.
- Mixed batch with confirmed price movement.
- Stale epoch and movement rejection.
- Browser refresh and clean-wallet recovery.
- Mobile, slow proof, slow RPC, and failed relayer states.

## Work package 9: Stateful verification

### State-machine actions

Generate arbitrary valid and invalid sequences of:

- Proposal.
- LP deposit.
- LP funding withdrawal.
- Cancellation.
- Activation.
- Shielded user deposit.
- Private order.
- Batch.
- Change recovery.
- Active LP exit request.
- Exit cancellation.
- Replacement match.
- Close.
- Resolve YES.
- Resolve NO.
- VOID.
- User claim.
- User refund.
- Fee vest.
- LP terminal redemption.
- TTL extension.

### Invariants after every action

- SAC balances equal the sum of named accounting classes.
- User liabilities remain fully covered.
- LP reserve and LP claims reconcile.
- No market can spend another market's reserve.
- No fee becomes revenue before its condition.
- No nullifier succeeds twice.
- No batch state version succeeds twice.
- No terminal path depends on creator return.
- Price changes only with an executed batch.
- Direct permutations do not alter allocation.
- Existing market claims remain unaffected.

### Concurrency tests

- Two LPs fill the final funding slot.
- LP funding withdrawal races activation.
- Two replacement LPs match one exit.
- Exit cancellation races match.
- Two batches use one pre-state.
- Final batch races close.
- Resolution races VOID.
- Aggregate redemption races LP settlement.
- Two users claim the same recovered note.

## Work package 10: Live testnet deployment

### Deployment order

1. Upload reviewed market, liquidity-vault, factory, and shared-collateral-vault WASM.
2. Deploy the factory with approved hashes, collateral, resolver policy, liquidity tiers, fee caps, and batch policy caps.
3. Deploy the shared shielded collateral vault and protocol rounding reserve.
4. Configure the committee, relayers, indexers, keepers, treasury shielded key, multisig, and timelock.
5. Create one proposal from a creator account with no USDC.
6. Fund it from at least three independent LP accounts, including Moros through the ordinary path.
7. Activate and verify every linked identifier.
8. Execute fixed-lot mixed batches from independent bettor accounts.
9. Complete change recovery, YES, NO, VOID, user claims, LP profit, LP loss, queued exit, replacement exit, and terminal LP redemption.
10. Rebuild one indexer and one clean browser from durable data.
11. Enable more proposals only after the first full matrix passes.

### No partial activation

Frontend and services fail closed when any component reports a different:

- Network.
- USDC SAC.
- Factory.
- Market WASM hash.
- Liquidity-vault WASM hash.
- Shared vault.
- Market.
- Resolver.
- Committee epoch.
- Verification key.
- Fee policy.
- Batch policy.
- Rules hash.
- Liquidity target.

## Testnet release gates

1. At least 100 simulated bettors and 20 LPs complete arbitrary stateful sequences.
2. At least 10 user-created proposals cover funded, underfunded, cancelled, resolved, and voided paths.
3. At least 1,000 private fixed-lot intents complete without an unexplained atomic unit.
4. Every private batch has both sides and an allowed size.
5. A lone order never changes price and becomes refundable.
6. Public odds always match the last confirmed batch state.
7. Active exit requests never reduce market backing.
8. Replacement liquidity changes ownership without changing `b`, reserve, or user liabilities.
9. LP profit, loss, fees, and principal reconcile in YES, NO, and VOID cases.
10. Committee, coordinator, relayer, keeper, indexer, RPC, browser, and backup failures each have a tested recovery.
11. Rust builds and tests end with `cargo clean` and no remaining target directories.
12. The user verifies the deployed flow before any merge to `main`.

## Mainnet prohibition

Do not deploy this liquidity system to mainnet until:

- Independent contract and circuit audits finish.
- Every critical and high finding is fixed and retested.
- The fixed-point pricing model is independently reproduced.
- The LP withdrawal language matches actual liquidity in every state.
- Testnet data supports fee, lot, batch, capacity, and liquidity-tier parameters.
- The resolver stack for every enabled category has its own mainnet gate.
- Committee and relayer operations are distributed.
- Incident, pause, refund, and recovery procedures are public.
- Mainnet USDC and all deployed hashes are independently verified.

## Suggested logical commits

1. `test: capture liquidity and pricing baseline`
2. `test: add market economics reference fixtures`
3. `feat: add permissionless market liquidity vault`
4. `feat: add proposal funded market activation`
5. `feat: add terminal lp settlement`
6. `feat: add uniform private batch pricing`
7. `feat: add private lp and batch circuits`
8. `feat: add refundable trade fee escrow`
9. `feat: add liquidity and batch operations services`
10. `feat: add liquidity and indicative pricing flows`
11. `test: add multi-user liquidity lifecycle coverage`
12. `docs: add liquidity operations and risk guide`

Split commits further when a contract, circuit, service, or UI unit has its own complete tests. Do not combine unrelated layers in one commit.
