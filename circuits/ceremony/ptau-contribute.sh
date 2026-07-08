#!/usr/bin/env bash
set -e
if [ $# -lt 3 ]; then
  echo "usage: $0 <ptau-in> <ptau-out> <contributor-name>"
  echo "phase-1 contribution; each independent participant runs this once, in order"
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
SNARKJS="$HERE/../node_modules/.bin/snarkjs"
"$SNARKJS" powersoftau contribute "$1" "$2" --name="$3" -v
echo "contribution by '$3' written to $2"
