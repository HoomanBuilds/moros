# Operations runbook

Production hardening beyond the contracts/circuits. Testnet demos skip most of this; a
real deployment needs all of it.

## Committee (t-of-n threshold decryption)
- Run each member (`committee/member.mjs`) on an INDEPENDENTLY operated host. Three members
  on one VM proves the architecture only; the no-leak trust claim holds solely if fewer than
  `t` operators can collude.
- Env per member: `PORT`, `INDEX`, `MEMBER_TOKEN` (shared bearer), `MEMBER_SK` (its own
  Stellar key), `ATTEST_TARGET`/`ATTEST_METHOD`/`ATTEST_DQ_OFFSET` (pool + submit_batch_committee),
  `SHARE_FILE` (persisted share, mode 0600, gitignored, backed up securely).
- DKG is commit-reveal (Gennaro): members publish a hash of their Feldman commitments before
  any reveal, so a member cannot bias the joint key after seeing others'. Shares travel
  member-to-member; the coordinator relays only public commitments and never holds a share.
- Persistence: a restarted member restores its share from `SHARE_FILE` and refuses to re-key;
  the server reuses the existing epoch (no orphaned ciphertexts). Rotating the key = new epoch:
  delete share files, re-run DKG, publish the new `pk`; orders encrypted to the old `pk` must
  be drained first.
- Put TLS in front of every member and the intake server (token auth is transport-level only).

## Admin -> Stellar multisig
The market/pool admin (set_committee, set_batcher, set_resolver, fund, VK setters) must be a
Stellar account with multisig thresholds, not a single hot key:
- `stellar tx new set-options --master-weight 0 --low-threshold 2 --med-threshold 2 \
   --high-threshold 2 --signer <A>:1 --signer <B>:1 --signer <C>:1` (2-of-3 example).
- Author admin invocations, collect signatures out of band, submit. Never keep the admin seed
  on the intake server. Consider a timelock contract between admin intents and execution.

## Resolution (oracle-driven)
- Deploy `Resolver(oracle)` with the real Reflector testnet/mainnet oracle address.
- `market.set_resolver(admin, resolver)`; then `Resolver.resolve_market(market)` is
  permissionless and sets the outcome from the oracle iff `now >= expiry` and price >= threshold.
- Set the market `expiry` to the real event time; do NOT resolve by admin in production.

## Trusted setup
- The deployed Groth16 zkeys are single-contributor demo entropy. Before mainnet, run
  `circuits/ceremony/` with independent participants, then redeploy the on-chain VKs
  (`set_redeem_v2_vk`, encrypt-order VK consumers) to match the ceremony output.

## Money / solvency
- Fund the market with a `b*ln2` buffer before resolution (covers the LMSR operator subsidy).
- The pool is self-funding: it pays the market's net from escrowed stakes and reclaims
  winning shares via `claim_winnings` after resolution. Monitor pool balance >= outstanding
  redeemable entitlements.
