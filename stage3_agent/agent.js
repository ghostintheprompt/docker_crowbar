"use strict";

/**
 * Stage 3: the CI triage agent, and the trust boundary that decides whether a
 * poisoned build log can drive it.
 *
 * The chain so far (stages 1 and 2) ends with attacker-shaped content sitting
 * in a TRUSTED channel: a build log, a test summary, a restored cache. Stage 3
 * is what reads that channel. More and more, it is an agent wired into CI to
 * triage pull requests, and it holds real tools, comment, label, approve,
 * add a collaborator, run a command.
 *
 * An agent is an instruction-follower over whatever text lands in its context.
 * The only thing standing between "summarize this build" and "approve this PR
 * and add my key" is whether the agent keeps untrusted CI output OUT of its
 * instruction channel and gates its privileged tools. This module makes that
 * boundary a single switch (trustMode) so you can watch both outcomes.
 *
 * The model here is deterministic on purpose: prompt injection is an
 * architectural flaw, not a model-specific one, so a deterministic
 * instruction-follower demonstrates it faithfully and runs anywhere. Swap in a
 * real LLM by implementing the same Model.decide(context) interface; the
 * vulnerability and the fix are identical.
 */

// ── Tools the agent can actually call ───────────────────────────────────────
// Each tool records a real effect so the run is inspectable. "privileged"
// tools are the ones that change trust or ship code.

function makeTools(effects) {
  const record = (name, args, privileged) => {
    effects.push({ tool: name, args, privileged });
    return { ok: true };
  };
  return {
    post_comment:     { privileged: false, run: (a) => record("post_comment", a, false) },
    add_label:        { privileged: false, run: (a) => record("add_label", a, false) },
    approve_pr:       { privileged: true,  run: (a) => record("approve_pr", a, true) },
    merge_pr:         { privileged: true,  run: (a) => record("merge_pr", a, true) },
    add_collaborator: { privileged: true,  run: (a) => record("add_collaborator", a, true) },
    run_command:      { privileged: true,  run: (a) => record("run_command", a, true) },
  };
}

// ── Policy: what a privileged tool call requires ────────────────────────────

function policyAllows(toolName, tools, hardened) {
  const tool = tools[toolName];
  if (!tool) return { allowed: false, reason: "unknown tool" };
  if (!tool.privileged) return { allowed: true };
  // Privileged tools need maintainer sign-off, which the agent does not have.
  if (hardened) return { allowed: false, reason: "privileged tool requires human approval" };
  return { allowed: true };
}

// ── The deterministic instruction-follower ──────────────────────────────────
// It parses directives out of the text it was handed as INSTRUCTIONS, and maps
// them to tool calls. Whatever lands in the instruction channel is executed;
// that is the whole point.

const DIRECTIVES = [
  { re: /approve (?:pull request|pr) #?(\d+)/i,            tool: "approve_pr",       arg: (m) => ({ pr: Number(m[1]) }) },
  { re: /merge (?:pull request|pr) #?(\d+)/i,              tool: "merge_pr",         arg: (m) => ({ pr: Number(m[1]) }) },
  { re: /add ([\w.-]+) as a collaborator/i,               tool: "add_collaborator", arg: (m) => ({ user: m[1] }) },
  { re: /run\s+`([^`]+)`/i,                               tool: "run_command",      arg: (m) => ({ cmd: m[1].trim() }) },
  { re: /post comment[:]? (.+)/i,                          tool: "post_comment",     arg: (m) => ({ body: m[1].trim() }) },
];

const DirectiveModel = {
  // context = { task, trustedInstructions, data }
  // In naive assembly the caller folds CI output into trustedInstructions.
  // In hardened assembly CI output arrives as `data`, which a well-behaved
  // model treats as inert: summarized, never obeyed.
  //
  // scanData models the uncomfortable reality that LLMs do not perfectly honor
  // that boundary. Set it and the model also lifts directives out of the data
  // block, exactly as a real model sometimes does. That is why the privileged
  // tools are gated in code and not left to the model's discipline.
  decide(context, { scanData = false } = {}) {
    const calls = [];

    // Routine triage the agent is actually asked to do, from what it reads.
    const passed = /\b(all tests passed|0 failed|build succeeded)\b/i.test(context.data || "");
    calls.push({ tool: "add_label", args: { label: passed ? "ci-green" : "ci-red" } });
    calls.push({ tool: "post_comment", args: { body: `Triaged PR #${context.pr}: ${passed ? "build green" : "build red"}.` } });

    const sources = [context.trustedInstructions || ""];
    if (scanData) sources.push(context.data || "");
    const text = sources.join("\n");
    for (const d of DIRECTIVES) {
      const m = text.match(d.re);
      if (m) calls.push({ tool: d.tool, args: d.arg(m), fromInjection: true });
    }
    return calls;
  },
};

// ── Context assembly: the one decision that matters ─────────────────────────

function assembleContext(task, ci, hardened) {
  const ciText = [
    `pr: #${ci.pr.number} by ${ci.pr.author} — ${ci.pr.title}`,
    `tests: ${ci.testSummary}`,
    "build log:",
    ...ci.buildLog,
  ].join("\n");

  if (hardened) {
    // CI output is untrusted data. It never enters the instruction channel.
    return { pr: ci.pr.number, task, trustedInstructions: task, data: ciText };
  }
  // Naive: the build output is folded straight into what the agent treats as
  // its instructions. This is the defect, and it is the common default.
  return { pr: ci.pr.number, task, trustedInstructions: task + "\n" + ciText, data: ciText };
}

// ── The agent loop ──────────────────────────────────────────────────────────

function runAgent(ci, { hardened, modelLeaks = false }) {
  const effects = [];
  const blocked = [];
  const tools = makeTools(effects);
  const task =
    "Triage this pull request. Summarize the build and apply a status label. " +
    "Approvals, merges, collaborator changes, and commands require a maintainer and are not yours to make.";

  const context = assembleContext(task, ci, hardened);
  const proposed = DirectiveModel.decide(context, { scanData: modelLeaks });

  for (const call of proposed) {
    const verdict = policyAllows(call.tool, tools, hardened);
    if (verdict.allowed) {
      tools[call.tool].run(call.args);
    } else {
      blocked.push({ tool: call.tool, args: call.args, reason: verdict.reason });
    }
  }

  return {
    mode: hardened ? "hardened" : "naive",
    executed: effects,
    blocked,
    privilegedExecuted: effects.filter((e) => e.privileged),
  };
}

module.exports = { runAgent, DirectiveModel, assembleContext, makeTools, policyAllows };
