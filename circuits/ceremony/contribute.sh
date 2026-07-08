#!/usr/bin/env bash
set -e
if [ $# -lt 3 ]; then
  echo "usage: $0 <zkey-in> <zkey-out> <contributor-name>"
  echo "each independent participant runs this once, in order, passing the previous output as input"
  echo "entropy is prompted interactively and never stored"
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
SNARKJS="$HERE/../node_modules/.bin/snarkjs"
"$SNARKJS" zkey contribute "$1" "$2" --name="$3" -v
echo "contribution by '$3' written to $2"
echo "publish the transcript hash printed above so others can audit the chain"
