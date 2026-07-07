# Off-chain batcher + relayer

Two Node scripts that orchestrate the ZK-batched market. No trusted matching: the
batcher only nets and proves; correctness is enforced on-chain by the batch proof.

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

## Notes
- Demo scale: fixed N=4 orders per batch (depth-2 order tree). Larger N needs a bigger
  circuit + ptau; proving is server-side (snarkjs, BLS12-381) - the 4 GB VM target.
- Batch amounts should be fixed-point shares (`share * 2^32`) for meaningful odds/cost;
  the example uses raw values (net LMSR cost ~0).
- Unaudited research prototype, testnet only.
