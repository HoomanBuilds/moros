# Dependency Security Remediation Plan

## Goal

Remove currently fixable dependency vulnerabilities without weakening the Stellar wallet, committee, keeper, circuit, or contract flows.

## Current State

- GitHub reports zero open critical Dependabot alerts.
- The previously critical `protobufjs` advisory is fixed by `protobufjs` 7.6.5.
- Remaining high alerts are concentrated in transitive JavaScript dependencies including `axios`, `ws`, `brace-expansion`, `bfj`, `jsonpath`, and `underscore`.
- Rust advisories affect `soroban-env-host` and `stellar-xdr` in the shielded pool lockfile.
- Several automated fixes propose major-version changes, so each dependency path must be reviewed before updating.

## Work

1. Map every vulnerable package to its direct parent and available patched release.
2. Apply safe direct upgrades, package overrides, and lockfile refreshes in logical groups.
3. Upgrade Stellar Rust dependencies only where the workspace compiles and contract tests remain compatible.
4. Run package audits, service tests, frontend unit tests, TypeScript checks, lint, production build, Playwright tests, and Rust contract tests.
5. Record any residual advisory that has no compatible upstream fix, including its reachability and mitigation.
6. Commit JavaScript and Rust remediation separately, then remove Cargo target directories.

## Release Gate

- Zero open critical alerts.
- No fixable high alert remains without a documented reason.
- All existing regression suites pass.
- Production contract IDs, USDC collateral configuration, keeper, and committee wiring remain unchanged.
- No Cargo target directory remains after validation.

## Outcome

- Web: zero critical or high alerts. The patched Axios version is enforced because Stellar SDK currently pins a vulnerable release. Remaining alerts are low or moderate transitive packages in the latest Wallets Kit adapters and Next.js. Automated remediation proposes incompatible downgrades, so no downgrade was applied.
- Services: zero critical, high, or moderate alerts. Axios and WebSocket are pinned to patched releases. SnarkJS uses `bfj` 7.0.2, which stays inside its declared major range and avoids the vulnerable JSONPath dependency added in 7.1.0.
- Circuits: zero dependency alerts. SnarkJS uses the same compatible `bfj` pin.
- Rust: the `soroban-env-host` advisory is absent from the WASM dependency graph. The `stellar-xdr` advisory is introduced by Soroban SDK macros, and the contract does not parse attacker-controlled XDR strings. Patched releases require a Soroban SDK major upgrade that would change contract bytecode and require a new audited deployment, so deployed testnet bytecode was not changed in this dependency-only pass.
- Clean `npm ci` installs reproduce all three JavaScript dependency trees.
- Frontend unit tests, TypeScript, lint, production build, Playwright tests, service configuration tests, live Reflector verification, and the ZK encryption plus threshold-decryption test pass.
