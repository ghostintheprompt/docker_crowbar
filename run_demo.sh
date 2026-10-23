#!/usr/bin/env bash
# The full chain, end to end, against containers this lab owns.
#   1. baseline: an unauthorized transfer is denied by both apps
#   2. fire the crowbar: force the policy sidecar into an OOM
#   3. degraded: the same unauthorized transfer now succeeds on the fail-open app
set -euo pipefail

cd "$(dirname "$0")"

echo "[demo] building and starting the stack..."
docker compose up -d --build
trap 'docker compose down >/dev/null 2>&1 || true' EXIT
sleep 5

say() { printf '\n== %s ==\n' "$1"; }
hit() { curl -s -X POST "localhost:$1/transfer" -H 'x-subject: anonymous'; echo; }

say "baseline (policy healthy): unauthorized transfer"
printf 'vulnerable (fail-open):  '; hit 8081
printf 'hardened  (fail-closed): '; hit 8082

say "fire the crowbar (force policy OOM)"
curl -s localhost:7070/balloon >/dev/null 2>&1 || true
echo "[demo] waiting for the OOM kill to land..."
sleep 8

say "degraded (policy down): same unauthorized transfer"
printf 'vulnerable (fail-open):  '; hit 8081
printf 'hardened  (fail-closed): '; hit 8082

echo
echo "[demo] vulnerable app should now report verdict=ALLOW, degraded=true."
echo "[demo] hardened app should still report verdict=DENY."
