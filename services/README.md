# Off-chain batcher + relayer

Orchestrates the ZK-batched market. No trusted matching: the batcher only nets and
proves; correctness is enforced on-chain by the batch proof. Run it as one-shot
scripts (`batcher.mjs` / `relayer.mjs`) or as a long-running intake service
(`server.mjs`).

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

## Notes
- Demo scale: fixed N=4 orders per batch (depth-2 order tree). Larger N needs a bigger
  circuit + ptau; proving is server-side (snarkjs, BLS12-381) - the 4 GB VM target.
- Batch amounts should be fixed-point shares (`share * 2^32`) for meaningful odds/cost;
  the example uses raw values (net LMSR cost ~0).
- The `SOURCE` identity is a funded key on the box (pays fees) - treat it as a hot key.
- Unaudited research prototype, testnet only.
