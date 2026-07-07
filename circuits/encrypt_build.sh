#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
SNARKJS=node_modules/.bin/snarkjs
NAME=encrypt

if [ ! -f build/potbn15_final.ptau ]; then
  echo "powers of tau (bn128, power 15)"
  $SNARKJS powersoftau new bn128 15 build/potbn15_0.ptau >/dev/null
  $SNARKJS powersoftau contribute build/potbn15_0.ptau build/potbn15_1.ptau --name=c1 -e="enc-entropy-1" >/dev/null
  $SNARKJS powersoftau prepare phase2 build/potbn15_1.ptau build/potbn15_final.ptau >/dev/null
fi

echo "groth16 setup"
$SNARKJS groth16 setup build/$NAME.r1cs build/potbn15_final.ptau build/${NAME}_0.zkey >/dev/null
$SNARKJS zkey contribute build/${NAME}_0.zkey build/${NAME}_final.zkey --name=c2 -e="enc-entropy-2" >/dev/null
$SNARKJS zkey export verificationkey build/${NAME}_final.zkey build/${NAME}_vk.json >/dev/null
echo "done: build/${NAME}_final.zkey + build/${NAME}_vk.json"
