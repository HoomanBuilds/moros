# Shielded-pool proving tooling

The withdraw proofs embedded in `contract/src/test.rs` are generated off-chain
with the upstream fork's CLIs (`stellar-coinutils`, `stellar-circom2soroban`)
from `ymcrcat/soroban-privacy-pools`, cloned into `inspiration/` (git-ignored).

## `coinutils-side.patch`
Market adaptation binds `side` into the note commitment
(`precommitment = Poseidon(nullifier, Poseidon(secret, side))`). That requires the
coin generator to compute + carry `side`, mirroring `circuits/commitment.circom`.
This patch adds a `--side` flag and threads `side` through coin generation, the
coin/snark JSON, and the withdrawal-input builder.

Apply against a fresh clone of the fork's `cli/coinutils`:
```
cd inspiration/zk/soroban-privacy-pools
git apply <repo>/contracts/shielded-pool/tooling/coinutils-side.patch
cargo build --release --bin stellar-coinutils
```

## Regenerating the withdraw VK + proof
Trusted setup is a self-run BLS12-381 ceremony (no prebuilt ptau exists). The
withdraw circuit is ~16.5k constraints -> **power-15** ptau.
```
cd contracts/shielded-pool/circuits
circom main.circom --r1cs --wasm -l <circomlib> -l . --prime bls12381 -o build
snarkjs powersoftau new bls12-381 15 build/pot15_0.ptau
snarkjs powersoftau contribute build/pot15_0.ptau build/pot15_1.ptau -e=...
snarkjs powersoftau prepare phase2 build/pot15_1.ptau build/pot15_final.ptau
snarkjs groth16 setup build/main.r1cs build/pot15_final.ptau output/main_0.zkey
snarkjs zkey contribute output/main_0.zkey output/main_final.zkey -e=...
snarkjs zkey export verificationkey output/main_final.zkey output/main_verification_key.json
```
Then generate a coin (`stellar-coinutils generate <scope> --side 0|1`), build the
state + association, `stellar-coinutils withdraw`, add `recipient/relayer/fee/
winningOutcome` to the input, generate the witness, and `snarkjs groth16 prove`.
`recipient` must equal the contract's `recipient_field(to)` (see the
`recipient_field` fn); `winningOutcome` must equal `side`.

**Testnet/demo only - dev powers-of-tau, not a mainnet-safe ceremony.**

## Batch-netting (Phase 4)
`batch-input-generator.rs` is a coinutils bin (`src/bin/batch.rs`) that builds the
order tree (Poseidon255 + LeanIMT, matching `circuits/batch.circom`) and emits the
witness input for the batch-netting proof. Validated N=4: `dQYes=30, dQNo=20` from
4 hidden orders, verifies off-chain. ~3.2k constraints/order (N=16 ≈ 51k, fits 4 GB).
