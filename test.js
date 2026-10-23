"use strict";

// Deterministic proof of the decision the lab turns on. No Docker required, so
// this runs anywhere and in CI; the live Docker chain (run_demo.sh) shows the
// same divergence end to end.

const assert = require("assert");
const { decide } = require("./lib/decide");

let passed = 0;
function check(label, cond) {
  assert.ok(cond, "FAILED: " + label);
  console.log("PASS: " + label);
  passed++;
}

// Healthy policy: the app follows the sidecar's answer, fail mode is irrelevant.
check("healthy + allow -> ALLOW (fail-open)", decide({ reachable: true, allow: true }, "open") === "ALLOW");
check("healthy + deny  -> DENY  (fail-open)", decide({ reachable: true, allow: false }, "open") === "DENY");
check("healthy + deny  -> DENY  (fail-closed)", decide({ reachable: true, allow: false }, "closed") === "DENY");

// Degraded policy (the forced state): this is where the two modes diverge.
check("degraded -> ALLOW when fail-open  (the vulnerability)", decide({ reachable: false }, "open") === "ALLOW");
check("degraded -> DENY  when fail-closed (the fix)", decide({ reachable: false }, "closed") === "DENY");

// The attack in one line: forcing the sidecar down flips an unauthorized
// request from DENY to ALLOW on the fail-open app, and changes nothing on the
// fail-closed one.
const healthyUnauthorized = decide({ reachable: true, allow: false }, "open");
const forcedUnauthorized = decide({ reachable: false }, "open");
check("forcing the OOM flips unauthorized DENY -> ALLOW (fail-open)",
  healthyUnauthorized === "DENY" && forcedUnauthorized === "ALLOW");
check("same force changes nothing on fail-closed",
  decide({ reachable: true, allow: false }, "closed") === "DENY" &&
  decide({ reachable: false }, "closed") === "DENY");

console.log(`\n${passed}/${passed} assertions passing.`);
