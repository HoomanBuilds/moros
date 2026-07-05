#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
SNARKJS=node_modules/.bin/snarkjs
CIRCOM=${CIRCOM:-circom}
NAME=bet_validity
mkdir -p build

echo "1. compile ($NAME, bls12381)"
$CIRCOM $NAME.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build --prime bls12381

echo "2. powers of tau"
$SNARKJS powersoftau new bls12-381 12 build/pot_0.ptau >/dev/null
$SNARKJS powersoftau contribute build/pot_0.ptau build/pot_1.ptau --name=c1 -e="entropy1" >/dev/null
$SNARKJS powersoftau prepare phase2 build/pot_1.ptau build/pot_final.ptau >/dev/null

echo "3. groth16 setup"
$SNARKJS groth16 setup build/$NAME.r1cs build/pot_final.ptau build/${NAME}_0.zkey >/dev/null
$SNARKJS zkey contribute build/${NAME}_0.zkey build/${NAME}_final.zkey --name=c2 -e="entropy2" >/dev/null
$SNARKJS zkey export verificationkey build/${NAME}_final.zkey build/verification_key.json >/dev/null

echo "4. witness + prove"
node build/${NAME}_js/generate_witness.js build/${NAME}_js/$NAME.wasm inputs/bet.json build/witness.wtns
$SNARKJS groth16 prove build/${NAME}_final.zkey build/witness.wtns build/proof.json build/public.json

echo "5. verify off-chain"
$SNARKJS groth16 verify build/verification_key.json build/public.json build/proof.json
echo "public signals [commitment, cap]:"; cat build/public.json
