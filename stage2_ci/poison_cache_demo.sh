#!/usr/bin/env bash
# Stage 2, local model: GitHub Actions cache poisoning reduced to its essence.
#
# In the wild (see the TanStack and Angular compromises), a pull_request_target
# workflow runs untrusted fork code with access to the default-branch cache,
# writes a poisoned entry, and a later TRUSTED release job restores that cache
# by key and runs what it finds. The dangerous part is the shared, trusted
# cache, not the specific payload.
#
# This models exactly that with two local "jobs" and a cache directory, so the
# mechanism is provable without live CI. The payload is a marker that prints a
# line. Nothing is published, no secret is read, no third party is touched.
#
#   ./poison_cache_demo.sh shared     # vulnerable: one cache key for both jobs
#   ./poison_cache_demo.sh isolated   # fixed: trust-scoped keys, poison stranded
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-shared}"
CACHE="${CACHE_DIR:-$(mktemp -d)}"

# The untrusted build job always writes under the key it controls.
write_key="deps"
# The trusted release job restores under a key chosen by the trust model:
#   shared   -> same key, so it restores what the untrusted job wrote
#   isolated -> a separate, trust-scoped key the untrusted job cannot write
if [ "$MODE" = "isolated" ]; then
  restore_key="deps-trusted"
else
  restore_key="deps"
fi

echo "[mode] $MODE   (write_key=$write_key  restore_key=$restore_key)"

# --- untrusted build job (runs attacker-influenced code) --------------------
mkdir -p "$CACHE/$write_key"
cat > "$CACHE/$write_key/postinstall.sh" <<'PAYLOAD'
#!/usr/bin/env bash
echo "CACHE-POISON-MARKER: payload executed inside the trusted release job"
PAYLOAD
chmod +x "$CACHE/$write_key/postinstall.sh"
echo "[build/untrusted] wrote postinstall.sh into cache key '$write_key'"

# --- trusted release job (holds the real permissions) -----------------------
hook="$CACHE/$restore_key/postinstall.sh"
if [ -x "$hook" ]; then
  echo "[release/trusted] restored cache key '$restore_key'; running its postinstall hook:"
  "$hook"
else
  echo "[release/trusted] cache key '$restore_key' is clean; nothing poisoned ran"
fi
