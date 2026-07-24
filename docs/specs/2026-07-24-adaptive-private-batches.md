# Adaptive private batches

## Status

Approved for the clean Moros testnet deployment.

## Goal

Private orders must execute without requiring eight orders while preserving atomic uniform pricing, complete FIFO inclusion, pooled LMSR liquidity, private position ownership, and permissionless recovery.

## Batch policy

- Each market has one private order queue and one LMSR price state.
- A new batch waits for the first order flow before starting its execution window.
- Before proving the first order, the relayer calls the permissionless and idempotent epoch opener. Its confirmed ledger timestamp starts the 60-second window.
- The opener persists the cutoff and refund deadline before proof generation. Order binding and acceptance read those same values and never recalculate them.
- A client starts proof generation only when at least 30 seconds remain. Near-cutoff orders wait for the next epoch instead of risking a proof that expires during submission.
- The batch executes early when eight orders are accepted.
- A batch with one to seven orders executes when the window ends.
- One-sided batches are valid because pooled LMSR liquidity is the counterparty.
- Every accepted real order is included. The coordinator cannot select a subset.
- All units on the same side receive the same batch price.
- The market price changes only when a valid batch executes.
- A failed or unavailable execution becomes permissionlessly refundable after the recovery deadline.
- Fees apply only to executed quantities.

## Proof policy

- The batch circuit keeps eight physical witness slots.
- `acceptedCount` must be between one and eight.
- Slots below `acceptedCount` are real contiguous FIFO orders.
- Remaining slots are canonical zero-quantity padding with valid encryption points.
- Padding is excluded from accepted, allocation, and included roots.
- Padding cannot change aggregate quantities, charges, fees, payouts, or market prices.
- Padding is never counted as a privacy participant.
- The proof remains bound to the deployment, vault, market, epoch, accepted root, accepted count, sequence range, committee configuration, aggregate ciphertext, quote, allocation root, and included root.

## Public privacy boundary

- Market identity, order timing, accepted count, aggregate YES and NO quantities, settled prices, and aggregate fees are public.
- The bettor wallet, private note ownership, individual balance, individual allocation, and private history remain unlinked from the order.
- A singleton batch reveals its aggregate side and quantity after execution, but not the bettor wallet.
- The single-VM testnet committee can inspect individual decrypted orders. Mainnet privacy requires independent threshold committee operators and aggregate-only decryption.

## Empty and terminal markets

- Empty batches do not roll every 60 seconds.
- An idle epoch remains open until its first order or market expiry.
- The first order flow sets the batch cutoff through the relayed epoch opener, capped by market expiry.
- Opening an epoch requires no wallet authorization and does not link the bettor's wallet to the market.
- An empty epoch at market expiry can close without creating bettor refunds.
- The final non-empty batch either executes before its recovery deadline or becomes refundable.

## Clean deployment rule

- No old market, proposal, comment, profile, watchlist, private sync, storage object, browser namespace, VM registry, or runtime error record is imported.
- Old on-chain testnet contracts remain immutable but are not referenced by the application or services.
- Fresh contracts use standard names and one canonical deployment manifest.
- The frontend, private service, keeper, committee, pooled LP automation, and Supabase registry must all use the fresh manifest.

## Affected layers

- `lmsr-market`: partial and one-sided batch quotes.
- `shielded-collateral-vault`: adaptive epoch timing, partial batch acceptance, execution, and recovery.
- `market-factory`: adaptive policy validation and registration.
- `privacy-types` and `zk-verifier`: public statement compatibility and verifier wiring.
- Batch circuit and proving artifacts: active slots and canonical padding.
- Private coordinator and protocol utilities: partial order loading, padding, aggregate proof construction, and execution.
- Web private actions and batch-window logic: adaptive availability and accurate status.
- Market, portfolio, create, and landing UI: maximum batch size, countdown, singleton disclosure, claims, and refunds.
- Fresh lifecycle harness: singleton, partial mixed, full, one-sided, failure, refund, resolution, claim, and LP harvest coverage.
- VM and deployment scripts: clean runtime, fresh IDs, and no legacy services.
