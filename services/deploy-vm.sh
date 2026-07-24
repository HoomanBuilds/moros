#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
bundle="$repo/deploy-bundle.tar.gz"

ARTIFACTS=(
  "deployments/private-testnet.json"
  "circuits/private-build/public"
)

RUNTIME_FILES=(
  "circuits/private/artifacts.mjs"
  "services/.env.example"
  "services/Caddyfile.moros"
  "services/README.md"
  "services/committee/bn254-babyjub.mjs"
  "services/config.mjs"
  "services/deploy-vm.sh"
  "services/deployment-utils.mjs"
  "services/market-registry.mjs"
  "services/oracle-config.mjs"
  "services/package-lock.json"
  "services/package.json"
  "services/private-allocation-registry.mjs"
  "services/private-artifacts.mjs"
  "services/private-batch-coordinator.mjs"
  "services/private-exit-registry.mjs"
  "services/private-indexer.mjs"
  "services/private-market-registry.mjs"
  "services/private-proposal-registry.mjs"
  "services/private-protocol.mjs"
  "services/private-relayer.mjs"
  "services/private-server.mjs"
  "services/resolve-keeper.mjs"
  "services/soroban-runtime.mjs"
)

cmd="${1:-provision}"

case "$cmd" in
package)
  echo "[package] bundling the clean runtime, canonical deployment, and private proving artifacts"
  ( cd "$repo" && tar czf "$bundle" \
      "${RUNTIME_FILES[@]}" \
      "${ARTIFACTS[@]}" 2>/dev/null )
  echo "[package] wrote $bundle"
  ;;

provision)
  command -v node >/dev/null || { echo "install Node 22+ first"; exit 1; }
  echo "[provision] node $(node --version), installing service deps"
  ( cd "$here" && npm install --no-audit --no-fund )

  missing=0
  for a in "${ARTIFACTS[@]}"; do
    [ -e "$repo/$a" ] || { echo "[provision] MISSING: $a"; missing=1; }
  done
  [ "$missing" = 1 ] && { echo "[provision] run './deploy-vm.sh package' on the build machine and unpack the bundle here"; exit 1; }

  [ -f "$here/.env" ] || echo "[provision] create services/.env with the private service, keeper, and Supabase settings before starting"
  echo "[provision] ready. install units: ./deploy-vm.sh service"
  ;;

service)
  node_bin="$(command -v node)"
  unit=/etc/systemd/system/zkmarket-resolve-keeper.service
  sudo tee "$unit" >/dev/null <<UNIT
[Unit]
Description=Moros testnet price resolution keeper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env
ExecStart=$node_bin $here/resolve-keeper.mjs
Restart=on-failure
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
UNIT

  unit=/etc/systemd/system/zkmarket-private.service
  sudo tee "$unit" >/dev/null <<UNIT
[Unit]
Description=Moros private market service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env
Environment=PRIVATE_PORT=8788
ExecStart=$node_bin $here/private-server.mjs
Restart=on-failure
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
UNIT

  sudo systemctl daemon-reload
  sudo systemctl enable --now zkmarket-resolve-keeper
  sudo systemctl enable --now zkmarket-private
  for legacy in zkmarket-server zkmarket-member1 zkmarket-member2 zkmarket-member3; do
    sudo systemctl disable --now "$legacy" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/$legacy.service"
  done
  sudo systemctl daemon-reload
  sudo systemctl restart zkmarket-resolve-keeper zkmarket-private
  echo "[service] private logs: journalctl -u zkmarket-private -f"
  echo "[service] keeper logs: journalctl -u zkmarket-resolve-keeper -f"
  echo "[service] testnet uses the deployment manifest's single-VM committee identity"
  ;;

*)
  echo "usage: $0 {package|provision|service}"; exit 1;;
esac
