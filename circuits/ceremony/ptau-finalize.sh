#!/usr/bin/env bash
set -e
if [ $# -lt 3 ]; then
  echo "usage: $0 <ptau-in> <ptau-final-out> <beacon-hex> [iterations-exp]"
  echo "apply a PUBLIC randomness beacon (e.g. a drand round or block hash) then prepare phase 2"
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
SNARKJS="$HERE/../node_modules/.bin/snarkjs"
TMP="$(mktemp --suffix=.ptau)"
"$SNARKJS" powersoftau beacon "$1" "$TMP" "$3" "${4:-10}" -v
"$SNARKJS" powersoftau prepare phase2 "$TMP" "$2" -v
rm -f "$TMP"
"$SNARKJS" powersoftau verify "$2"
echo "finalized ptau written to $2"
