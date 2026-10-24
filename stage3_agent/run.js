"use strict";

// Run the CI triage agent against a clean build and a poisoned one, in the
// naive trust model and the hardened one, and show the blast radius.

const fs = require("fs");
const path = require("path");
const { runAgent } = require("./agent");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

// Potential impact if these simulated calls were connected to live tools.
const BLAST = {
  approve_pr:       "removed the human gate on this change",
  merge_pr:         "poison merged into main; every fork and every pipeline that pulls now carries it",
  add_collaborator: "attacker foothold that outlives the PR and the fix",
  run_command:      "reseeds the cache, so every future run re-poisons itself",
};

function show(label, result) {
  console.log(`\n=== ${label} (${result.mode}) ===`);
  for (const e of result.executed) {
    console.log(`  recorded ${e.tool}(${JSON.stringify(e.args)})${e.privileged ? "  [PRIVILEGED]" : ""}`);
  }
  for (const b of result.blocked) {
    console.log(`  BLOCKED ${b.tool}(${JSON.stringify(b.args)}) — ${b.reason}`);
  }
  if (result.privilegedExecuted.length) {
    console.log("  potential impact with live tool permissions:");
    for (const e of result.privilegedExecuted) {
      console.log(`    - ${e.tool}: ${BLAST[e.tool] || "privileged action taken"}`);
    }
  }
}

const poisoned = load("poisoned-ci.json");
const clean = load("clean-ci.json");

show("poisoned build, naive agent", runAgent(poisoned, { hardened: false }));
show("poisoned build, hardened agent (CI kept as data)", runAgent(poisoned, { hardened: true }));
show("poisoned build, hardened agent, model leaked the boundary", runAgent(poisoned, { hardened: true, modelLeaks: true }));
show("clean build, naive agent", runAgent(clean, { hardened: false }));

console.log(
  "\nSimulation only: the naive parser recorded four privileged calls from injected directives." +
  "\nThe hardened policy gate blocked them. No external action occurred; live-model" +
  "\nbehavior and downstream propagation were not tested."
);
