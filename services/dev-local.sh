#!/usr/bin/env bash
# Local committee stack for browser testing (members + intake server + indexer).
# Dev-only: open server (no SERVICE_TOKEN), ATTEST_ANY members, low BATCH_N.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log="/tmp/umbra-dev"
mkdir -p "$log"

FLAGSHIP_POOL="CDUYUZEZBIWRPXM3ITDQZBANHN3Q6B6KUKCBV7MP6BGLYRQCT6QSV23E"
FLAGSHIP_MARKET="CBKR2OYQHNBYUSHQEFEHB4GI6BMZYXP35GPYYCBKFRTZBTR6NV3P3MXS"
PORTS=(39761 39762 39763)
MEMBER_TOKEN="dev-member-token"
MEMBERS="http://127.0.0.1:39761,http://127.0.0.1:39762,http://127.0.0.1:39763"

echo "[dev] stopping any prior stack"
pkill -f "committee/member.mjs" 2>/dev/null
pkill -f "services/server.mjs" 2>/dev/null
sleep 1

echo "[dev] starting 3 committee members (ATTEST_ANY dev mode)"
for i in 1 2 3; do
  sk="$(stellar keys show comm$i)"
  MEMBER_SK="$sk" INDEX="$i" PORT="${PORTS[$((i-1))]}" MEMBER_TOKEN="$MEMBER_TOKEN" \
    ATTEST_ANY=1 ATTEST_METHOD="submit_batch_committee" ATTEST_DQ_OFFSET=1 \
    SHARE_FILE="$log/member$i.share" \
    nohup node "$here/committee/member.mjs" > "$log/member$i.log" 2>&1 &
done

echo "[dev] waiting for members to be healthy"
for k in $(seq 1 100); do
  ok=1
  for p in "${PORTS[@]}"; do curl -sf "http://127.0.0.1:$p/health" >/dev/null || ok=0; done
  [ "$ok" = 1 ] && break
  sleep 0.3
done
echo "[dev] members healthy"

echo "[dev] starting committee intake server (open, indexes flagship + registered pools)"
SERVICE_TOKEN= POOL_ID="$FLAGSHIP_POOL" MARKET="$FLAGSHIP_MARKET" \
  MEMBERS="$MEMBERS" MEMBER_TOKEN="$MEMBER_TOKEN" THRESHOLD=2 \
  BATCH_N=2 WINDOW_MS=5000 CORS_ORIGIN="*" PORT=8787 \
  nohup node "$here/server.mjs" > "$log/server.log" 2>&1 &

echo "[dev] waiting for committee DKG + /pk (can take ~20-40s)"
for k in $(seq 1 200); do
  curl -sf "http://127.0.0.1:8787/pk" >/dev/null 2>&1 && break
  sleep 0.5
done

echo ""
echo "[dev] committee status:"
curl -s "http://127.0.0.1:8787/status" || echo "  (server not ready - check $log/server.log)"
echo ""
echo "[dev] logs: $log/{member1,member2,member3,server}.log"
echo "[dev] stop with: pkill -f committee/member.mjs; pkill -f services/server.mjs"
