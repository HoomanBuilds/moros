#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
fork="$repo/inspiration/zk/soroban-privacy-pools"
bundle="$repo/deploy-bundle.tar.gz"

ARTIFACTS=(
  "contracts/shielded-pool/circuits/build/encrypt_order_vk.json"
)

BINS=(
  "inspiration/zk/soroban-privacy-pools/target/release/stellar-circom2soroban"
  "inspiration/zk/soroban-privacy-pools/target/release/tree_proof"
)

MEMBER_PORTS=(9711 9712 9713)

cmd="${1:-provision}"

case "$cmd" in
package)
  echo "[package] bundling the order verification key and native helper binaries"
  ( cd "$repo" && tar czf "$bundle" \
      "${ARTIFACTS[@]}" \
      "${BINS[@]}" 2>/dev/null )
  echo "[package] wrote $bundle - scp to the VM repo root, then: tar xzf deploy-bundle.tar.gz"
  ;;

provision)
  command -v node >/dev/null || { echo "install Node 22+ first"; exit 1; }
  echo "[provision] node $(node --version), installing service deps"
  ( cd "$repo/circuits" && npm install --no-audit --no-fund )
  ( cd "$here" && npm install --no-audit --no-fund )

  if [ ! -x "$fork/target/release/tree_proof" ] || [ ! -x "$fork/target/release/stellar-circom2soroban" ]; then
    command -v cargo >/dev/null || { echo "install Rust (rustup) or unpack the bundle for prebuilt bins"; exit 1; }
    echo "[provision] building rust bins"
    ( cd "$fork" && cargo build --release --bin tree_proof --bin stellar-circom2soroban )
  fi

  missing=0
  for a in "${ARTIFACTS[@]}"; do
    [ -f "$repo/$a" ] || { echo "[provision] MISSING: $a"; missing=1; }
  done
  for b in "${BINS[@]}"; do
    [ -x "$repo/$b" ] || { echo "[provision] MISSING: $b"; missing=1; }
  done
  [ "$missing" = 1 ] && { echo "[provision] run './deploy-vm.sh package' on the build machine and unpack the bundle here"; exit 1; }

  [ -f "$here/.env" ] || echo "[provision] create services/.env (MARKET, POOL_ID, SOURCE, FUNDER_SK, SERVICE_TOKEN, MEMBER_TOKEN) before starting"
  for i in 1 2 3; do
    [ -f "$here/.env.member$i" ] || echo "[provision] create services/.env.member$i with INDEX=$i PORT=${MEMBER_PORTS[$((i-1))]} MEMBER_SK=<comm$i secret> MARKET=<market id> MEMBER_TOKEN=<same as server>"
  done
  echo "[provision] ready. install units: ./deploy-vm.sh service"
  ;;

service)
  node_bin="$(command -v node)"
  for i in 1 2 3; do
    unit=/etc/systemd/system/zkmarket-member$i.service
    sudo tee "$unit" >/dev/null <<UNIT
[Unit]
Description=ZK market committee member $i (holds only its own key share)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env.member$i
ExecStart=$node_bin $here/committee/member.mjs
Restart=on-failure
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
UNIT
  done

  unit=/etc/systemd/system/zkmarket-server.service
  sudo tee "$unit" >/dev/null <<UNIT
[Unit]
Description=ZK market no-leak intake server (ciphertexts only, coordinator windows)
After=network-online.target zkmarket-member1.service zkmarket-member2.service zkmarket-member3.service
Wants=zkmarket-member1.service zkmarket-member2.service zkmarket-member3.service

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env
Environment=MEMBERS=http://127.0.0.1:${MEMBER_PORTS[0]},http://127.0.0.1:${MEMBER_PORTS[1]},http://127.0.0.1:${MEMBER_PORTS[2]}
ExecStart=$node_bin $here/server.mjs
Restart=on-failure
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
UNIT

  sudo systemctl daemon-reload
  sudo systemctl enable --now zkmarket-member1 zkmarket-member2 zkmarket-member3
  sudo systemctl enable --now zkmarket-server
  echo "[service] started. logs: journalctl -u zkmarket-server -f"
  echo "[service] NOTE: all 3 members on one VM demonstrates the architecture only;"
  echo "[service] real no-leak trust needs each member on an independently operated host."
  ;;

*)
  echo "usage: $0 {package|provision|service}"; exit 1;;
esac
