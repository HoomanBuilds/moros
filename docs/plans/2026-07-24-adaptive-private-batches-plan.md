# Adaptive private batches implementation plan

## Scope

Replace the exact-eight execution requirement with one adaptive private queue. Keep the existing reusable private USDC wallet, pooled liquidity, LMSR pricing, proof gateway, private activity sync, claims, refunds, oracle resolution, and portfolio flows.

## Implementation

1. Preserve the current quote-wrapper, signer-isolation, recovery, and wallet-scan fixes in logical commits.
2. Rename fixed batch policy fields to maximum batch policy fields across contract ABIs and application types.
3. Remove the minimum-side requirement.
4. Make the first order flow relay an idempotent epoch-open call that persists its 60-second cutoff before proof generation.
5. Seal at eight accepted orders or at the active cutoff.
6. Permit one to eight accepted orders in batch submission.
7. Handle zero quantity on either quote side without division or remainder failures.
8. Add active-slot constraints and canonical inactive padding to the batch circuit.
9. Update fixtures, public statement builders, allocation packages, and coordinator execution.
10. Update frontend waiting logic, market copy, countdowns, privacy disclosure, and portfolio states.
11. Extend unit and lifecycle tests for singleton, one-sided partial, mixed partial, full, stale state, proof failure, timeout refund, resolution, claim, and LP harvest.
12. Build fresh proving artifacts and contract WASM files.
13. Recover safely accessible testnet funds without importing any old market data.
14. Erase Moros Supabase records and objects, browser namespaces, and VM runtime registries.
15. Deploy a fresh standard-named contract stack and write one canonical deployment manifest.
16. Repackage and activate the private service and keeper with the fresh manifest.
17. Verify exact IDs through public config, VM environment, frontend configuration, and direct contract reads.
18. Run a completely fresh live lifecycle.
19. Run final Rust, circuit, service, TypeScript, unit, lint, build, browser, security, dependency, stale-reference, and storage checks.
20. Commit and push the verified feature branch without merging `main`.

## Acceptance

- One YES order executes after the active 60-second window and changes prices once.
- One NO order executes after the active 60-second window and changes prices once.
- Proof preparation and order acceptance use the same persisted cutoff and refund deadline even when several ledgers close between them.
- Two to seven mixed orders execute together with complete FIFO inclusion.
- Eight orders execute before the deadline when capacity is reached.
- Empty markets do not create recurring settlement transactions.
- One-sided batches remain solvent and receive correct charges, fees, payouts, and price movement.
- The next epoch reads the updated market state.
- Failed execution never changes the market and every affected order is refundable.
- Old Supabase and VM data remain absent.
- Only fresh contract IDs appear in active application and service wiring.
- No Cargo target directory remains after validation.
