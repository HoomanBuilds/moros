#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
fork="$repo/inspiration/zk/soroban-privacy-pools"
bundle="$repo/deploy-bundle.tar.gz"

ARTIFACTS=(
  "contracts/shielded-pool/circuits/build/batch_js/batch.wasm"
  "contracts/shielded-pool/circuits/output/batch_final.zkey"
  "contracts/shielded-pool/circuits/output/order_redeem_final.zkey"
)

cmd="${1:-provision}"

case "$cmd" in
package)
  echo "[package] bundling proving artifacts + rust bins (git-ignored, must match deployed VKs)"
  ( cd "$repo" && tar czf "$bundle" \
      "${ARTIFACTS[@]}" \
      inspiration/zk/soroban-privacy-pools/target/release/batch \
      inspiration/zk/soroban-privacy-pools/target/release/stellar-circom2soroban 2>/dev/null )
  echo "[package] wrote $bundle - scp to the VM repo root, then: tar xzf deploy-bundle.tar.gz"
  ;;

provision)
  command -v node >/dev/null || { echo "install Node 22+ first"; exit 1; }
  command -v cargo >/dev/null || { echo "install Rust (rustup) first"; exit 1; }
  echo "[provision] node $(node --version), installing snarkjs"
  ( cd "$repo/circuits" && npm install --no-audit --no-fund )

  if [ ! -x "$fork/target/release/batch" ] || [ ! -x "$fork/target/release/stellar-circom2soroban" ]; then
    echo "[provision] building rust bins"
    ( cd "$fork" && cargo build --release --bin batch --bin stellar-circom2soroban )
  fi

  missing=0
  for a in "${ARTIFACTS[@]}"; do
    [ -f "$repo/$a" ] || { echo "[provision] MISSING: $a"; missing=1; }
  done
  [ "$missing" = 1 ] && { echo "[provision] run './deploy-vm.sh package' on the build machine and unpack the bundle here"; exit 1; }

  [ -f "$here/.env" ] || echo "[provision] create services/.env with POOL_ID and SOURCE before starting"
  echo "[provision] ready. start: node $here/server.mjs   (or ./deploy-vm.sh service)"
  ;;

service)
  unit=/etc/systemd/system/zkmarket-batcher.service
  sudo tee "$unit" >/dev/null <<UNIT
[Unit]
Description=ZK prediction market batcher/relayer
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env
ExecStart=$(command -v node) $here/server.mjs
Restart=on-failure
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now zkmarket-batcher
  echo "[service] started. logs: journalctl -u zkmarket-batcher -f"
  ;;

*)
  echo "usage: $0 {package|provision|service}"; exit 1;;
esac
