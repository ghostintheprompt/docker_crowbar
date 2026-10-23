#!/usr/bin/env bash
# Deterministic proof of Stage 2, no live CI required. The shared-cache model
# must execute the poison in the trusted job; the trust-scoped model must not.
set -euo pipefail
cd "$(dirname "$0")"

pass=0

shared="$(CACHE_DIR="$(mktemp -d)" ./poison_cache_demo.sh shared)"
if echo "$shared" | grep -q "CACHE-POISON-MARKER"; then
  echo "PASS: shared cache key -> poison runs in the trusted release job"
  pass=$((pass + 1))
else
  echo "FAIL: shared cache key did not execute the poison"; exit 1
fi

isolated="$(CACHE_DIR="$(mktemp -d)" ./poison_cache_demo.sh isolated)"
if echo "$isolated" | grep -q "CACHE-POISON-MARKER"; then
  echo "FAIL: trust-scoped key still executed the poison"; exit 1
else
  echo "PASS: trust-scoped cache key -> poison is stranded, trusted job runs clean"
  pass=$((pass + 1))
fi

echo
echo "$pass/2 assertions passing."
