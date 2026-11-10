#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
cmd="${1:-provision}"

case "$cmd" in
provision)
  command -v node >/dev/null || { echo "install Node 22+ first"; exit 1; }
  (cd "$here" && npm ci --no-audit --no-fund)
  echo "Configure services/.env and preserve the existing payment deployment state and artifacts before installing services."
  ;;
service)
  [ -f "$here/.env" ] || { echo "services/.env is required"; exit 1; }
  node_bin="$(command -v node)"
  units=(moros-stellar-rpc)
  sudo tee /etc/systemd/system/moros-stellar-rpc.service >/dev/null <<UNIT
[Unit]
Description=Moros shared Stellar RPC
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env
EnvironmentFile=-$here/.env.stellar-rpc
Environment=STELLAR_RPC_PORT=8788
ExecStart=$node_bin $here/stellar-rpc-server.mjs
Restart=on-failure
RestartSec=5
User=$USER
[Install]
WantedBy=multi-user.target
UNIT

  for network in testnet mainnet; do
    state="$repo/deployments/payments-$network.local.json"
    public="$repo/deployments/payments-$network.json"
    if [ ! -f "$state" ] || [ ! -f "$public" ] || [ ! -d "$repo/apps/pay-web/public/zk/payments" ]; then
      echo "Skipping unconfigured payment network: $network"
      continue
    fi
    port=8790
    [ "$network" = mainnet ] && port=8791
    unit="zkmarket-payments-$network"
    units+=("$unit")
    sudo tee "/etc/systemd/system/$unit.service" >/dev/null <<UNIT
[Unit]
Description=Moros private payments $network service
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$here/.env
EnvironmentFile=-$here/.env.payments-$network
Environment=MOROS_PAYMENT_NETWORK=$network
Environment=PAYMENT_PORT=$port
ExecStart=$node_bin $here/payment-server.mjs
Restart=on-failure
RestartSec=5
User=$USER
[Install]
WantedBy=multi-user.target
UNIT
  done
  sudo systemctl daemon-reload
  sudo systemctl enable "${units[@]}"
  sudo systemctl restart "${units[@]}"
  ;;
*)
  echo "usage: $0 {provision|service}"
  exit 1
  ;;
esac
