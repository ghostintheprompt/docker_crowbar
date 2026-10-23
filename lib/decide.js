"use strict";

/**
 * The one decision the whole lab turns on.
 *
 * When the policy sidecar answers, the app follows that answer. When the
 * sidecar does NOT answer (the degraded state an attacker can force), the
 * app has to choose on its own. Fail-open allows; fail-closed denies.
 *
 * policyResult: { reachable: boolean, allow?: boolean }
 * failMode:     "open" | "closed"
 */
function decide(policyResult, failMode) {
  if (policyResult.reachable) {
    return policyResult.allow ? "ALLOW" : "DENY";
  }
  // Sidecar silent. This branch is the whole vulnerability. CWE-636.
  return failMode === "open" ? "ALLOW" : "DENY";
}

module.exports = { decide };
