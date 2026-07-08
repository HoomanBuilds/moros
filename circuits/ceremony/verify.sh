#!/usr/bin/env bash
set -e
if [ $# -lt 3 ]; then
  echo "usage: $0 <circuit.r1cs> <pot.ptau> <final.zkey>"
  echo "verifies the full contribution chain of a zkey against its circuit and powers-of-tau"
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
SNARKJS="$HERE/../node_modules/.bin/snarkjs"
"$SNARKJS" zkey verify "$1" "$2" "$3"
