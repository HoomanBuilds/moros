# Off-chain batcher + relayer

Orchestrates the ZK-batched market. **Correctness is trustless** (the net update is a
Groth16 proof verified on-chain), but the batcher is **trusted with order privacy** -
see "Trust model" below. Run it as one-shot scripts (`batcher.mjs` / `relayer.mjs`) or
as a long-running intake service (`server.mjs`).

## Setup
Create `services/.env` (git-ignored) with your deployment:
```
POOL_ID=CB555GWM...        # the shielded pool contract id
NETWORK=testnet
SOURCE=deployer            # stellar CLI identity that pays fees (the relayer/batcher account)
```
Prereqs (already built in this repo): the `batch` bin and `stellar-circom2soroban`
under `inspiration/.../target/release`, snarkjs under `circuits/node_modules`, and the
compiled batch circuit + zkey under `contracts/shielded-pool/circuits/{build,output}`.

## Batcher
Collects a window's orders (each trader's opening: `amount, side, secret, nullifier`),
builds the order tree, proves the net `(dQYes, dQNo)`, and submits `submit_batch`.
```
node services/batcher.mjs services/orders.example.json
```
The traders must have already placed the matching commitments on-chain via
`place_order` (the batcher builds the same tree from the openings, so the on-chain
order root matches the proof). With `POOL_ID` unset it prints the submit args instead
of submitting (dry run).

## Relayer
Submits a winner's redeem proof so the recipient bound in the proof is paid, with no
signature from the recipient (unlinkable).
```
node services/relayer.mjs redeem_proof.json redeem_public.json GRECIPIENT...
```

## Hosted service (`server.mjs`)
A long-running HTTP service: intake for orders + redeem proofs, plus a batch-window
loop that auto-batches when `BATCH_N` orders are pending.
```
POOL_ID=... SOURCE=deployer PORT=8787 WINDOW_MS=60000 node services/server.mjs
```
Endpoints:
- `POST /order`  `{amount, side, secret, nullifier}` (decimal strings) - queue a trader's opening. The trader must have already `place_order`'d the matching commitment on-chain, in the same order.
- `POST /batch`  - force a batch now (needs `BATCH_N` pending). The window loop also fires every `WINDOW_MS`.
- `POST /redeem` `{proof, public, recipient}` - relay a winner's redeem proof (JSON objects from snarkjs).
- `GET  /status` - pending count + config.

## Hosting on a VM (`deploy-vm.sh`)
The proving artifacts (`*.zkey`, `batch.wasm`) are git-ignored AND must match the
deployed contracts' embedded VKs, so they cannot be regenerated on the VM. Ship them:
```
# on the build machine:
./services/deploy-vm.sh package        # -> deploy-bundle.tar.gz (artifacts + rust bins)
# on the VM (after git clone + scp/untar the bundle at repo root):
./services/deploy-vm.sh provision      # installs snarkjs, builds/uses bins, verifies artifacts
./services/deploy-vm.sh service        # installs + starts a systemd unit (journalctl -u zkmarket-batcher -f)
```

## Trust model + security (read this)
- **The batcher learns order openings.** To prove the net, the batcher receives each
  order's `amount, side, secret, nullifier`. That means the operator sees individual
  positions (privacy is from the *chain/public*, not from the operator) AND, because it
  holds the `secret`, it could in principle craft a redeem proof for a winning order to
  an address it controls. So the batcher is a **trusted party for privacy + custody**,
  even though it cannot forge an incorrect net (the chain rejects that). The production
  fix is client-side / per-trader proving with proof aggregation so the operator never
  sees secrets - that is roadmap, not built here.
- **Auth**: set `SERVICE_TOKEN` in `.env`; all mutating endpoints require
  `Authorization: Bearer <token>`. Without it they are open (dev only, warned at start).
- **Secrets handling**: the pending queue is in-memory only (not persisted); the witness
  input + `.wtns` (which contain openings) and the redeem temp files are deleted after
  each use. Restarting the server drops the queue (traders resubmit).
- **Hot key**: `SOURCE` is a funded signing key on the box that pays fees - fund it
  minimally and rotate it. **Terminate TLS in front** (reverse proxy); the intake
  carries secrets, so never expose it over plaintext HTTP.
- Input is validated (decimal fields, `side ∈ {0,1}`), body size and queue length are
  capped.

## Notes
- Demo scale: fixed N=4 orders per batch (depth-2 order tree). Larger N needs a bigger
  circuit + ptau; proving is server-side (snarkjs, BLS12-381) - the 4 GB VM target.
- Batch amounts should be fixed-point shares (`share * 2^32`) for meaningful odds/cost;
  the example uses raw values (net LMSR cost ~0).
- The `SOURCE` identity is a funded key on the box (pays fees) - treat it as a hot key.
- Unaudited research prototype, testnet only.
