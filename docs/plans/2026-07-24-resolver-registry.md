# Resolver registry plan

## Goal

Allow Moros to add price and event resolver adapters without redeploying the shared shielded vault, pooled liquidity vault, or market contracts.

## Invariants

- A market proposal pins one resolver address, route revision, registration policy, and risk group.
- An activated market never changes its resolver.
- Governance can add, replace, or disable routes only through a timelock.
- The registry stores at most 64 routes and exposes one bounded TTL refresh.
- Disabling or replacing a route blocks unactivated proposals that pinned the old revision.
- Existing active markets remain unaffected by later registry changes.
- The shared shielded USDC vault and pooled LP remain common infrastructure.
- Each market retains isolated liquidity accounting and category risk limits.
- Unsupported event markets remain disabled in the UI until observers, challenges, arbitration, refunds, and monitoring are operational.

## Contract changes

1. Add a `resolver-registry` contract with bounded initial routes, governance authorization, a timelock, persistent route storage, explicit deadlines, revision checks, events, and TTL extension.
2. Replace the factory's fixed resolver and fixed asset list with the registry address.
3. Resolve and pin the route when a proposal is created.
4. Revalidate the exact route revision before activation.
5. Set the market's immutable resolver to the pinned adapter.
6. Call the standard event adapter registration hook only for routes that require it.

## Deployment and application changes

- Deploy and verify the registry before the factory.
- Seed current Reflector assets as price routes.
- Record the registry address and policy in the deployment manifest.
- Validate factory, registry, resolver, vault, and LP wiring in services and the browser.
- Maintain route TTL from the resolution keeper.
- Manage routes through `npm run resolver:route -- status|propose|execute|cancel`.
- Keep price creation limited to the enabled route list exposed by the deployment.

## Verification

- Registry unit tests cover authorization, delay boundaries, duplicate initial routes, stale revisions, cancellation, disabling, and TTL reads.
- Factory tests cover pinned route data, unsupported routes, and proposal identifier binding.
- Run the complete contract, service, and frontend suites.
- Build optimized WASM and verify every contract remains below the network size limit.
- Clean Cargo artifacts after verification.
