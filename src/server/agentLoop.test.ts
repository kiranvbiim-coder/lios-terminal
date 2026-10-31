import assert from "node:assert/strict";
import test from "node:test";
import { AgentPlanError, agentInputSha256, agentPlanSha256, resumeAgentLoop, runAgentLoop, type AgentLoopDeps, type AgentLoopSkill, type AgentLoopTool, type AgentPlannedStep, type AgentToolRun } from "./agentLoop";
import { sealAgentEvent, type AgentEventInput, type AgentRunEvent } from "./exec/agent-run-events";

const tool = (id: string, decision: AgentLoopTool["decision"] = "allow"): AgentLoopTool => ({
  id, label: `Tool ${id}`, kind: "calculate", permissionClass: decision === "allow" ? "safe_auto" : "user_confirm", sideEffect: "none", decision,
});
const TOOLS = [tool("t.quote"), tool("t.calc"), tool("t.confirm", "confirm"), tool("t.denied", "deny")];
const plan = (steps: unknown[]) => JSON.stringify({ steps });
const step = (id: string, toolId = "t.quote", extra: Record<string, unknown> = {}) => ({ id, toolId, label: `Run ${id}`, input: { symbol: "SAFE" }, dependsOn: [], ...extra });
const complete = (answer = "Done.") => JSON.stringify({ decision: "complete", answer });

interface Harness {
  deps: AgentLoopDeps;
  prompts: Array<{ system: string; user: string }>;
  ledger: AgentRunEvent[];
  ran: string[];
  results: string[];
}

function harness(models: Array<string | Error>, options: {
  budget?: Partial<AgentLoopDeps["budget"]>;
  tools?: AgentLoopTool[];
  skills?: AgentLoopSkill[];
  invoke?: (
    step: AgentPlannedStep,
    allocateDelegationBudget: AgentLoopDeps["invokeTool"] extends (call: infer T) => unknown
      ? T extends { allocateDelegationBudget: infer A } ? A : never
      : never,
  ) => Promise<AgentToolRun>;
  signal?: AbortSignal;
  ledgerFails?: boolean;
} = {}): Harness {
  const prompts: Harness["prompts"] = [];
  const ledger: AgentRunEvent[] = [];
  const ran: string[] = [];
  const results: string[] = [];
  const queue = [...models];
  const deps: AgentLoopDeps = {
    goal: "Compare the quotes",
    tools: options.tools ?? TOOLS,
    ...(options.skills ? { skills: options.skills } : {}),
    budget: { maxSteps: 6, maxAiCalls: 5, maxRevisions: 1, ...options.budget },
    signal: options.signal ?? new AbortController().signal,
    callModel: async (call) => {
      prompts.push(call);
      const next = queue.shift();
      if (next === undefined) throw new Error("model called more often than the test scripted");
      if (next instanceof Error) throw next;
      return next;
    },
    invokeTool: async ({ step: planned, allocateDelegationBudget }) => {
      ran.push(planned.id);
      if (options.invoke) return options.invoke(planned, allocateDelegationBudget);
      return { kind: "ok", summary: `result of ${planned.id}`, deterministic: true, sourceRefs: [`src:${planned.id}`] };
    },
    ledger: async (event: AgentEventInput) => {
      if (options.ledgerFails) throw new Error("journal unavailable");
      ledger.push(sealAgentEvent(ledger, event, "2026-10-05T00:00:00.000Z"));
    },
    onPlan: async () => undefined,
    onStepStart: async () => undefined,
    onStepResult: async (outcome) => { results.push(`${outcome.id}:${outcome.status}`); },
    onRevise: async () => undefined,
  };
  return { deps, prompts, ledger, ran, results };
}

test("plans, acts in dependency order, inspects and completes, writing a legal ledger", async () => {
  const h = harness([plan([step("b", "t.calc", { dependsOn: ["a"] }), step("a")]), complete("Quotes compared.")]);
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.answer, "Quotes compared.");
  assert.deepEqual(h.ran, ["a", "b"], "a dependency runs before its dependent regardless of listing order");
  assert.equal(outcome.aiCalls, 2);
  assert.equal(outcome.revisions, 0);
  assert.deepEqual(h.results, ["a:completed", "b:completed"]);
  assert.deepEqual(h.ledger.map((event) => event.kind), [
    "step_started", "tool_call_started", "tool_call_finished", "step_finished",
    "step_started", "tool_call_started", "tool_call_finished", "step_finished",
  ]);
  const started = h.ledger.find((event) => event.kind === "tool_call_started");
  assert.equal(started?.kind === "tool_call_started" && started.inputSha256, agentInputSha256({ symbol: "SAFE" }));
});

test("LangAlpha-derived bounded response gate accepts fenced model plan and review around unrelated braces",async()=>{
  const h=harness([
    "Context {not json} and an aside \\n\\n\\`\\`\\`json\\n"+plan([step("alpha")])+"\\n\\`\\`\\`\\ntrailer {untrusted}",
    'Unrelated {"sample":"example"}\\n'+complete("Verified result."),
  ]);
  const done=await runAgentLoop(h.deps);
  assert.equal(done.status,"completed");
  assert.equal(done.answer,"Verified result.");
  assert.deepEqual(h.ran,["alpha"]);
  assert.equal(done.revisions,0);
});

test("LangAlpha-derived bounded model gate keeps oversized response out of the execution path", async()=>{
  const h=harness(["x".repeat(256001),plan([step("safe")]),complete("Recovered.")], {budget:{maxRevisions:1}});
  const done=await runAgentLoop(h.deps);
  assert.equal(done.status,"completed");
  assert.deepEqual(h.ran,["safe"]);
  assert.equal(done.revisions,1);
  assert.match(h.prompts[1]!.user,/bounded JSON parsing limit/);
  assert.equal(h.prompts[1]!.user.includes("x".repeat(1000)),false);
});

test("the review prompt carries tool summaries only, never the model's raw tool input", async () => {
  const h = harness([plan([step("a", "t.quote", { input: { symbol: "PRIVATE-ARG" } })]), complete()]);
  await runAgentLoop(h.deps);
  assert.equal(h.prompts[1]!.user.includes("PRIVATE-ARG"), false);
  assert.match(h.prompts[1]!.user, /result of a/);
});

test("review guidance forbids claiming an unplanned tool action is prepared", async () => {
  const h = harness([plan([step("inspect")]), complete("Inspection complete.")]);
  await runAgentLoop(h.deps);
  assert.match(h.prompts[1]!.system, /NOT satisfied until that tool step has been planned, executed or paused/);
  assert.match(h.prompts[1]!.system, /use "revise" with the exact step from observed results/);
});

test("governed connected observations remain available beyond the generic status-summary cutoff", async () => {
  const tools = ["lios.provider.connected_sources", "lios.provider.connected_preview", "lios.external-mcp.allowed_tools"].map(id => tool(id));
  for (const descriptor of tools) {
    const h = harness([plan([step("inspect", descriptor.id)]), complete()], {
      tools,
      invoke: async () => ({ kind: "ok", summary: "Bounded observation ".repeat(35) + '{"period":"Q2","amount":14,"toolId":"lookup.record"}', deterministic: true, sourceRefs: [] }),
    });
    await runAgentLoop(h.deps);
    assert.ok(h.prompts[1].user.includes('"amount":14'));
    assert.ok(h.prompts[1].user.includes('"toolId":"lookup.record"'));
  }
});

test("each review repair resolves fresh ephemeral observations from completed steps only", async () => {
  const h = harness([
    plan([step("read"), step("failed", "t.calc", { dependsOn: ["read"] })]),
    "not a review",
    complete(),
  ], { invoke: async (planned) => planned.id === "failed"
    ? { kind: "failed", reason: "Unavailable" }
    : { kind: "ok", summary: "Read completed", deterministic: true, sourceRefs: ["src:read"] } });
  let resolutions = 0;
  h.deps.resolveReviewObservations = async ({ completedSteps, signal }) => {
    assert.equal(signal.aborted, false);
    assert.deepEqual(completedSteps.map(({ id, toolId }) => ({ id, toolId })), [{ id: "read", toolId: "t.quote" }]);
    resolutions += 1;
    return resolutions === 1
      ? { text: "CURRENT-PERMITTED-PASSAGE", sourceRefs: ["source:current"] }
      : { text: "CURRENT-RIGHTS-REVOKED", sourceRefs: [] };
  };
  const result = await runAgentLoop(h.deps);
  assert.equal(resolutions, 2, "repair must re-resolve rather than retain prior source permissions");
  assert.ok(h.prompts[1]!.user.includes("CURRENT-PERMITTED-PASSAGE"));
  assert.ok(h.prompts[2]!.user.includes("CURRENT-RIGHTS-REVOKED"));
  assert.equal(h.prompts[2]!.user.includes("CURRENT-PERMITTED-PASSAGE"), false);
  assert.equal(h.prompts[0]!.user.includes("CURRENT-PERMITTED-PASSAGE"), false, "planning is not evidence review");
  assert.equal(result.aiCalls, 3);
  assert.equal(result.revisions, 1);
  const durable = JSON.stringify([result, h.ledger, h.results]);
  assert.equal(durable.includes("CURRENT-PERMITTED-PASSAGE"), false);
  assert.equal(durable.includes("CURRENT-RIGHTS-REVOKED"), false);
  assert.deepEqual(h.ran, ["read", "failed"], "refresh never replays tool side effects");
});

test("ephemeral observation reads cannot bypass exhausted AI budget or cancellation", async () => {
  const limited = harness([plan([step("read")])], { budget: { maxAiCalls: 1 } });
  let reads = 0;
  limited.deps.resolveReviewObservations = async () => { reads += 1; return { text: "unused", sourceRefs: [] }; };
  const result = await runAgentLoop(limited.deps);
  assert.equal(result.status, "budget_exhausted");
  assert.equal(reads, 0);
  const controller = new AbortController();
  const cancelled = harness([plan([step("read")])], {
    signal: controller.signal,
    invoke: async () => {
      controller.abort();
      return { kind: "ok", summary: "Read completed", deterministic: true, sourceRefs: [] };
    },
  });
  cancelled.deps.resolveReviewObservations = async () => { reads += 1; return { text: "unused", sourceRefs: [] }; };
  await assert.rejects(runAgentLoop(cancelled.deps), { name: "AbortError" });
  assert.equal(reads, 0);
});

test("review provenance is bounded before a model receives cumulative references", async () => {
  const firstRefs = Array.from({ length: 60 }, (_, index) => `source:first:${index}`);
  const nextRefs = Array.from({ length: 60 }, (_, index) => `source:next:${index}`);
  const h = harness([plan([step("read")]), "invalid review", complete()]);
  let resolutions = 0;
  h.deps.resolveReviewObservations = async ({ reviewedSourceRefs }) => {
    resolutions += 1;
    if (resolutions === 1) {
      assert.deepEqual(reviewedSourceRefs, []);
      return { text: "first bounded source batch", sourceRefs: firstRefs };
    }
    assert.deepEqual(reviewedSourceRefs, firstRefs, "successful provider dispatch counts even when its response needs repair");
    return { text: "OVERCAP-MUST-NOT-TRANSMIT", sourceRefs: nextRefs };
  };
  await assert.rejects(runAgentLoop(h.deps), /source|reference|bound|limit/i);
  assert.equal(h.prompts.length, 2, "cumulative overflow must stop before the repaired model call");
  assert.equal(h.prompts.some((prompt) => prompt.user.includes("OVERCAP-MUST-NOT-TRANSMIT")), false);
});

test("successful review provenance survives approval resume independently of current observations", async () => {
  const h = harness([
    plan([step("read")]),
    JSON.stringify({ decision: "revise", steps: [step("confirm", "t.confirm")] }),
  ]);
  h.deps.resolveReviewObservations = async () => ({
    text: "EPHEMERAL-BEFORE-APPROVAL", sourceRefs: ["source:fresh-review"],
  });
  const paused = await runAgentLoop(h.deps);
  assert.equal(paused.status, "awaiting_approval");
  assert.ok(paused.resume);
  assert.deepEqual(paused.resume.reviewedSourceRefs, ["source:fresh-review"]);
  assert.equal(JSON.stringify(paused.resume).includes("EPHEMERAL-BEFORE-APPROVAL"), false);
  const resumed = harness([complete()], { invoke: async () => ({
    kind: "ok", summary: "Approved", deterministic: true, sourceRefs: [],
  }) });
  resumed.ledger.push(...h.ledger);
  resumed.ledger.push(sealAgentEvent(resumed.ledger, {
    kind: "tool_call_resumed", toolCallId: "confirm-call", approvalRef: "approval:review-provenance",
  }, "2026-10-05T00:00:00.000Z"));
  resumed.deps.resolveReviewObservations = async ({ reviewedSourceRefs }) => {
    assert.deepEqual(reviewedSourceRefs, ["source:fresh-review"]);
    return null;
  };
  const done = await resumeAgentLoop(resumed.deps, paused.resume);
  assert.deepEqual(done.reviewedSourceRefs, ["source:fresh-review"]);
  assert.equal(JSON.stringify(resumed.prompts).includes("EPHEMERAL-BEFORE-APPROVAL"), false);
});

test("model planning prompt exposes bounded tool-specific input guidance", async () => {
  const guided: AgentLoopTool = {
    ...tool("lios.entity.resolve"),
    label: "Resolve canonical entity, security and listing identity",
    planningHint: 'Use {"name":"<company name copied from the goal>"} for company names; never treat pronouns such as I as ticker symbols.',
  };
  const h = harness([
    plan([{
      id: "resolve",
      toolId: "lios.entity.resolve",
      label: "Resolve Microsoft",
      input: { name: "Microsoft Corporation" },
      dependsOn: [],
    }]),
    complete("Resolved."),
  ], { tools: [guided] });
  h.deps.goal = "Research Microsoft Corporation using only permitted sources I am allowed to use.";

  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.match(h.prompts[0]!.system, /Input guidance:/);
  assert.match(h.prompts[0]!.system, /Microsoft|company name copied from the goal/);
  assert.match(h.prompts[0]!.system, /pronouns such as I/);
  assert.deepEqual(h.ran, ["resolve"]);
});

test("strict plan-shape guidance repairs a local-model nullable optional field without weakening validation", async () => {
  const invalid = JSON.stringify({
    steps: [{
      id: "resolve",
      toolId: "t.quote",
      skillId: null,
      label: "Resolve input",
      input: { symbol: "SAFE" },
      dependsOn: [],
    }],
  });
  const h = harness([
    invalid,
    plan([step("resolve")]),
    complete("Recovered."),
  ], { budget: { maxRevisions: 1 } });

  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.answer, "Recovered.");
  assert.equal(outcome.revisions, 1);
  assert.deepEqual(h.ran, ["resolve"]);
  assert.match(h.prompts[0]!.system, /exactly one top-level key: "steps"/);
  assert.match(h.prompts[0]!.system, /Omit optional "skillId" when unused; never emit null/);
  assert.match(h.prompts[0]!.system, /Do not emit markdown fences/);
  assert.match(h.prompts[1]!.user, /steps\.0\.skillId/);
  assert.match(h.prompts[1]!.user, /Return ONLY a corrected JSON plan/);
});

test("local-model scalar dependencies are rejected and repaired to strict arrays", async () => {
  const invalid = JSON.stringify({
    steps: [
      step("a"),
      { ...step("b", "t.calc"), dependsOn: "a" },
      { ...step("c", "t.calc"), dependsOn: "b" },
    ],
  });
  const corrected = plan([
    step("a"),
    step("b", "t.calc", { dependsOn: ["a"] }),
    step("c", "t.calc", { dependsOn: ["b"] }),
  ]);
  const h = harness([
    invalid,
    corrected,
    complete("Dependencies repaired."),
  ], { budget: { maxRevisions: 1, maxSteps: 6 } });

  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.answer, "Dependencies repaired.");
  assert.equal(outcome.revisions, 1);
  assert.deepEqual(h.ran, ["a", "b", "c"]);
  assert.match(h.prompts[0]!.system, /Never use the scalar form "dependsOn":"step_1"/);
  assert.match(h.prompts[0]!.system, /"dependsOn":\["step_1"\]/);
  assert.match(h.prompts[1]!.user, /steps\.1\.dependsOn: Expected array/);
  assert.match(h.prompts[1]!.user, /Return ONLY a corrected JSON plan/);
});

test("bounded plan repair receives safe tool-schema diagnostics without rejected raw values", async () => {
  const strict: AgentLoopTool = {
    ...tool("lios.entity.resolve"),
    validateInput: (input) => typeof input.name === "string" && !("ticker" in input),
    inputValidationIssue: () => "input: Entity resolution requires exactly one of name, ticker, identifier, or providerId.",
  };
  const rejectedSecretLikeValue = "RAW-MODEL-VALUE-DO-NOT-ECHO";
  const h = harness([
    plan([{
      id: "resolve",
      toolId: "lios.entity.resolve",
      label: "Resolve Microsoft",
      input: { name: "Microsoft Corporation", ticker: rejectedSecretLikeValue },
      dependsOn: [],
    }]),
    plan([{
      id: "resolve",
      toolId: "lios.entity.resolve",
      label: "Resolve Microsoft",
      input: { name: "Microsoft Corporation" },
      dependsOn: [],
    }]),
    complete("Resolved."),
  ], { tools: [strict], budget: { maxRevisions: 1 } });

  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.revisions, 1);
  assert.deepEqual(h.ran, ["resolve"]);
  assert.match(h.prompts[1]!.user, /requires exactly one of name, ticker, identifier, or providerId/);
  assert.equal(h.prompts[1]!.user.includes(rejectedSecretLikeValue), false);
});

test("invalid post-step review is repaired once within the existing revision and AI-call budgets", async () => {
  const invalidReview = JSON.stringify({ decision: "revise", steps: null });
  const revised = JSON.stringify({
    decision: "revise",
    steps: [step("b", "t.calc", { dependsOn: ["a"] })],
  });
  const h = harness([
    plan([step("a")]),
    invalidReview,
    revised,
    complete("Reviewed and finished."),
  ], { budget: { maxRevisions: 2, maxAiCalls: 5 } });

  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.answer, "Reviewed and finished.");
  assert.equal(outcome.aiCalls, 4);
  assert.equal(outcome.revisions, 2, "one repair plus one semantic plan revision consume the existing revision budget");
  assert.deepEqual(h.ran, ["a", "b"]);
  assert.match(h.prompts[1]!.system, /Return exactly one JSON object and no other text/);
  assert.match(h.prompts[1]!.system, /"decision":"complete"/);
  assert.match(h.prompts[1]!.system, /"decision":"revise"/);
  assert.match(h.prompts[2]!.user, /previous review was rejected/);
  assert.match(h.prompts[2]!.user, /steps: Expected array/);
  assert.match(h.prompts[2]!.user, /Return ONLY a corrected JSON review/);
});

test("invalid plans are rejected: unknown or denied tools, reserved fields, duplicate ids, cycles, oversize and non-JSON", async () => {
  const bad: string[] = [
    plan([step("a", "t.unknown")]),
    plan([step("a", "t.denied")]),
    plan([step("a", "t.quote", { input: { tenant: { userId: 99 } } })]),
    plan([step("a", "t.quote", { input: { projectId: 7 } })]),
    plan([step("a"), step("a")]),
    plan([step("a", "t.quote", { dependsOn: ["b"] }), step("b", "t.quote", { dependsOn: ["a"] })]),
    plan([step("a", "t.quote", { dependsOn: ["ghost"] })]),
    plan([step("a", "t.quote", { input: { blob: "x".repeat(9_000) } })]),
    plan([step("a"), step("b"), step("c"), step("d"), step("e"), step("f"), step("g")]),
    "I will just answer without tools.",
    "{ not json }",
    JSON.stringify({ steps: [] }),
    JSON.stringify({ steps: [{ ...step("a"), extra: true }] }),
  ];
  for (const text of bad) {
    const h = harness([text], { budget: { maxRevisions: 0 } });
    await assert.rejects(runAgentLoop(h.deps), AgentPlanError, text.slice(0, 50));
    assert.deepEqual(h.ran, [], "an invalid plan executes nothing");
  }
});

test("installed P13 skills can guide a plan only through their declared governed tools", async () => {
  const skills: AgentLoopSkill[] = [{
    id: "skill.quotes",
    name: "Quote workflow",
    description: "Retrieve an approved quote and continue with governed analysis.",
    toolIds: ["t.quote"],
  }];
  const h = harness([
    plan([step("a", "t.quote", { skillId: "skill.quotes" })]),
    complete("Skill-guided plan complete."),
  ], { skills });
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(h.ran, ["a"]);
  assert.match(h.prompts[0]!.system, /Installed skills:/);
  assert.match(h.prompts[0]!.system, /skill\.quotes/);
  assert.match(h.prompts[0]!.system, /t\.quote/);
});

test("skill selection cannot widen the governed tool catalogue", async () => {
  const skills: AgentLoopSkill[] = [{
    id: "skill.quotes",
    name: "Quote workflow",
    description: "Quote-only procedure.",
    toolIds: ["t.quote"],
  }];
  const unknown = harness(
    [plan([step("a", "t.quote", { skillId: "skill.missing" })])],
    { skills, budget: { maxRevisions: 0 } },
  );
  await assert.rejects(runAgentLoop(unknown.deps), /not installed/);
  assert.deepEqual(unknown.ran, []);

  const widened = harness(
    [plan([step("a", "t.calc", { skillId: "skill.quotes" })])],
    { skills, budget: { maxRevisions: 0 } },
  );
  await assert.rejects(runAgentLoop(widened.deps), /does not declare tool/);
  assert.deepEqual(widened.ran, []);

  assert.notEqual(
    agentPlanSha256([step("a", "t.quote")]),
    agentPlanSha256([step("a", "t.quote", { skillId: "skill.quotes" })]),
    "skill identity is part of the exact validated plan hash",
  );
});

test("skill binding is enforced again on revised plans", async () => {
  const skills: AgentLoopSkill[] = [{
    id: "skill.quotes",
    name: "Quote workflow",
    description: "Quote-only procedure.",
    toolIds: ["t.quote"],
  }];
  const revise = JSON.stringify({
    decision: "revise",
    steps: [step("b", "t.calc", { skillId: "skill.quotes", dependsOn: ["a"] })],
  });
  const h = harness([
    plan([step("a", "t.quote", { skillId: "skill.quotes" })]),
    revise,
  ], { skills, budget: { maxRevisions: 1 } });
  await assert.rejects(runAgentLoop(h.deps), /does not declare tool/);
  assert.deepEqual(h.ran, ["a"], "the invalid revised skill step never executes");
});

test("resume fails closed when the selected skill is no longer installed", async () => {
  const skills: AgentLoopSkill[] = [{
    id: "skill.confirm",
    name: "Approval workflow",
    description: "Approval-gated procedure.",
    toolIds: ["t.confirm"],
  }];
  const h = harness([
    plan([step("a", "t.confirm", { skillId: "skill.confirm" })]),
  ], { skills });
  const paused = await runAgentLoop(h.deps);
  assert.equal(paused.status, "awaiting_approval");
  const next = harness([], { skills: [] });
  await assert.rejects(resumeAgentLoop(next.deps, paused.resume!), /not installed/);
  assert.deepEqual(next.ran, []);
});

test("one bounded repair: an invalid plan is retried once and then runs", async () => {
  const h = harness([plan([step("a", "t.unknown")]), plan([step("a")]), complete()], { budget: { maxRevisions: 1 } });
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.revisions, 1);
  assert.equal(outcome.aiCalls, 3);
  assert.match(h.prompts[1]!.user, /rejected/);
});


test("delegation allocations consume one authoritative parent remainder across siblings", async () => {
  const requested = { maxSteps: 3, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 5_000 };
  const allocations: Array<typeof requested> = [];
  const h = harness([
    plan([step("a"), step("b")]),
    complete("bounded"),
  ], {
    budget: { maxSteps: 6, maxAiCalls: 5, maxRevisions: 1, maxDurationMs: 20_000 },
    invoke: async (_planned, allocateDelegationBudget) => {
      const child = allocateDelegationBudget(requested);
      allocations.push({ ...child });
      return { kind: "ok", summary: "delegated", deterministic: false, sourceRefs: ["delegate:test"] };
    },
  });

  const outcome = await runAgentLoop(h.deps);
  assert.deepEqual(allocations, [requested], "the second sibling cannot reuse the first child budget slice");
  assert.deepEqual(outcome.steps.map((item) => item.status), ["completed", "failed"]);
  assert.match(outcome.steps[1]!.summary, /unexpected error|budget/i);
});

test("the AI-call budget is enforced and stops the run honestly with the results so far", async () => {
  const h = harness([plan([step("a")])], { budget: { maxAiCalls: 1 } });
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "budget_exhausted");
  assert.equal(outcome.stopReason, "ai_calls");
  assert.equal(outcome.answer, null);
  assert.equal(outcome.aiCalls, 1);
  assert.deepEqual(h.ran, ["a"]);

  const none = harness([], { budget: { maxAiCalls: 1 } });
  none.deps.budget.maxAiCalls = 0;
  const stopped = await runAgentLoop(none.deps);
  assert.equal(stopped.stopReason, "ai_calls");
  assert.deepEqual(none.ran, []);
});

test("revise adds steps within the step budget and the revision limit; exceeding either stops", async () => {
  const revise = (...steps: unknown[]) => JSON.stringify({ decision: "revise", steps });
  const ok = harness([plan([step("a")]), revise(step("b", "t.calc", { dependsOn: ["a"] })), complete("Final.")], { budget: { maxRevisions: 1 } });
  const outcome = await runAgentLoop(ok.deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(ok.ran, ["a", "b"]);
  assert.equal(outcome.revisions, 1);

  const limited = harness([plan([step("a")]), revise(step("b"))], { budget: { maxRevisions: 0 } });
  const stopped = await runAgentLoop(limited.deps);
  assert.equal(stopped.stopReason, "revisions");
  assert.deepEqual(limited.ran, ["a"]);

  const reuse = harness([plan([step("a")]), revise(step("a"))], { budget: { maxRevisions: 1 } });
  await assert.rejects(runAgentLoop(reuse.deps), /already used/);

  const tooMany = harness([plan([step("a"), step("b")]), revise(step("c"), step("d"), step("e"))], { budget: { maxSteps: 4, maxRevisions: 1 } });
  await assert.rejects(runAgentLoop(tooMany.deps), /budget/);
});

test("a confirm-class tool pauses the run for approval and is never invoked", async () => {
  const h = harness([plan([step("a"), step("b", "t.confirm", { dependsOn: ["a"] }), step("c", "t.calc", { dependsOn: ["b"] })])]);
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "awaiting_approval");
  assert.deepEqual(outcome.awaiting, { stepId: "b", toolId: "t.confirm" });
  assert.deepEqual(h.ran, ["a"]);
  assert.equal(outcome.aiCalls, 1, "no review call is spent while waiting for approval");
  // The wait is non-terminal: the call and its step stay open so the same run can continue after approval (L4).
  assert.equal(h.ledger.at(-1)?.kind, "tool_call_waiting_approval");
  assert.equal(h.ledger.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call"), false);
  assert.equal(h.ledger.some((event) => event.kind === "step_finished" && event.stepId === "b"), false);
  // Proof the same identities continue: release, finish and close without a new step or call id.
  const at = "2026-10-05T00:00:00.000Z";
  let chain = [...h.ledger];
  for (const event of [
    { kind: "tool_call_resumed", toolCallId: "b-call", approvalRef: "approval:granted-1" },
    { kind: "tool_call_finished", toolCallId: "b-call", status: "succeeded", outputRef: null },
    { kind: "step_finished", stepId: "b", status: "completed" },
  ] satisfies AgentEventInput[]) chain = [...chain, sealAgentEvent(chain, event, at)];
  assert.equal(chain.length, h.ledger.length + 3);
});

test("a tool that turns out to need approval or be denied at invocation is handled without running anything else", async () => {
  const approval = harness([plan([step("a"), step("b")])], { invoke: async () => ({ kind: "approval_required" }) });
  assert.equal((await runAgentLoop(approval.deps)).status, "awaiting_approval");
  assert.deepEqual(approval.ran, ["a"]);
  assert.equal(approval.ledger.at(-1)?.kind, "tool_call_waiting_approval", "an invoke-time approval requirement is also a non-terminal wait");

  const denied = harness([plan([step("a"), step("b", "t.calc", { dependsOn: ["a"] })]), complete("Could not.")], { invoke: async () => ({ kind: "denied" }) });
  const outcome = await runAgentLoop(denied.deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.steps.map((s) => s.status), ["denied", "skipped"]);
  assert.deepEqual(denied.ran, ["a"]);
});

test("a failing tool is recorded, its dependents are skipped, and the model still reviews the failure", async () => {
  const h = harness([plan([step("a"), step("b", "t.calc", { dependsOn: ["a"] }), step("c")]), complete("Partial.")], {
    invoke: async (planned) => {
      if (planned.id === "a") throw new Error("upstream 503");
      return { kind: "ok", summary: "fine", deterministic: true, sourceRefs: [] };
    },
  });
  const outcome = await runAgentLoop(h.deps);
  assert.deepEqual(outcome.steps.map((s) => `${s.id}:${s.status}`), ["a:failed", "b:skipped", "c:completed"]);
  assert.doesNotMatch(h.prompts[1]!.user, /upstream 503/, "raw exception text never reaches the model");
  assert.match(h.prompts[1]!.user, /unexpected error/);
  assert.equal(outcome.status, "completed");
});

test("tool failure details come only from a bounded classification, never from exception text", async () => {
  const leaky = new Error("password=hunter2 failed reading /Users/kiran/.ssh/id_rsa");
  const thrown = harness([plan([step("a")]), complete("Done.")], { invoke: async () => { throw leaky; } });
  const thrownOutcome = await runAgentLoop(thrown.deps);
  assert.equal(JSON.stringify([thrownOutcome, thrown.prompts]).includes("hunter2"), false);
  assert.equal(JSON.stringify([thrownOutcome, thrown.prompts]).includes("/Users/kiran"), false);

  const classified = harness([plan([step("a")]), complete("Done.")], { invoke: async () => ({ kind: "failed", reason: "the tool timed out." }) });
  const outcome = await runAgentLoop(classified.deps);
  assert.equal(outcome.steps[0]?.status, "failed");
  assert.match(classified.prompts[1]!.user, /the tool timed out\./);
  assert.equal(classified.ledger.at(-1)?.kind, "step_finished");
});

test("cancellation stops mid-tool, records cancelled, and rethrows the abort", async () => {
  const controller = new AbortController();
  const h = harness([plan([step("a"), step("b")])], {
    signal: controller.signal,
    invoke: async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    },
  });
  await assert.rejects(runAgentLoop(h.deps), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.deepEqual(h.ran, ["a"]);
  assert.equal(h.ledger.at(-1)?.kind, "step_finished");
  assert.equal((h.ledger.at(-1) as { status: string }).status, "cancelled");
});

test("a run cancelled before it starts never calls the model", async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness([plan([step("a")])], { signal: controller.signal });
  await assert.rejects(runAgentLoop(h.deps), (error: unknown) => error instanceof DOMException);
  assert.equal(h.prompts.length, 0);
});

test("a model that is unavailable fails the run: no fabricated plan or answer", async () => {
  await assert.rejects(runAgentLoop(harness([new Error("provider down")]).deps), /provider down/);
  const afterTools = harness([plan([step("a")]), new Error("provider down")]);
  await assert.rejects(runAgentLoop(afterTools.deps), /provider down/);
});

test("a failing ledger fails the run visibly", async () => {
  const h = harness([plan([step("a")]), complete()], { ledgerFails: true });
  await assert.rejects(runAgentLoop(h.deps), /journal unavailable/);
  assert.deepEqual(h.ran, [], "nothing executes when its step cannot be recorded");
});

test("a run without a journal still works", async () => {
  const h = harness([plan([step("a")]), complete()]);
  h.deps.ledger = null;
  assert.equal((await runAgentLoop(h.deps)).status, "completed");
});

/** Stands in for L2's atomic resumeAfterApproval, the only producer of tool_call_resumed. */
const releaseInLedger = (ledger: AgentRunEvent[]) => {
  ledger.push(sealAgentEvent(ledger, { kind: "tool_call_resumed", toolCallId: "b-call", approvalRef: "approval:granted-1" }, "2026-10-05T00:00:00.000Z"));
};

const pausedPlan = () => plan([step("a"), step("b", "t.confirm", { dependsOn: ["a"] }), step("c", "t.calc", { dependsOn: ["b"] })]);

test("resume continues the same plan and ids without asking the model for a new plan", async () => {
  const h = harness([pausedPlan()]);
  const paused = await runAgentLoop(h.deps);
  assert.equal(paused.status, "awaiting_approval");
  assert.ok(paused.resume && paused.planSha256);
  assert.equal(paused.resume.planSha256, paused.planSha256);
  assert.deepEqual(paused.resume.paused, { stepId: "b", toolId: "t.confirm", toolCallId: "b-call" });
  assert.equal(paused.planSha256, agentPlanSha256(paused.resume.steps));

  const prompts = h.prompts.length;
  const next = harness([complete("Approved and done.")]);
  next.ledger.push(...h.ledger);
  releaseInLedger(next.ledger);
  const outcome = await resumeAgentLoop(next.deps, paused.resume);
  assert.equal(next.prompts.length, 1, "only the review call; no plan call after approval");
  assert.equal(h.prompts.length, prompts);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(next.ran, ["b", "c"], "the paused step runs, then its dependent, and the settled step is not re-run");
  assert.equal(outcome.aiCalls, 2, "counters carry across the pause");
  const kinds = next.ledger.slice(h.ledger.length + 1).map((event) => event.kind);
  assert.equal(next.ledger.filter((event) => event.kind === "tool_call_resumed").length, 1, "the kernel appends no second resume");
  assert.equal(kinds[0], "tool_call_finished");
  assert.equal(next.ledger.filter((event) => event.kind === "step_started" && event.stepId === "b").length, 1, "no second step_started for the paused step");
});

test("resume refuses a plan whose hash no longer matches", async () => {
  const h = harness([pausedPlan()]);
  const paused = await runAgentLoop(h.deps);
  const tampered = { ...paused.resume!, steps: paused.resume!.steps.map((s) => (s.id === "c" ? { ...s, toolId: "t.quote" } : s)) };
  const next = harness([]);
  await assert.rejects(resumeAgentLoop(next.deps, tampered), AgentPlanError);
  assert.deepEqual(next.ran, []);
});

test("resume where the approval is still not enough records denied and does not loop", async () => {
  const h = harness([pausedPlan()]);
  const paused = await runAgentLoop(h.deps);
  const next = harness([complete("Could not.")], { invoke: async () => ({ kind: "approval_required" }) });
  next.ledger.push(...h.ledger);
  releaseInLedger(next.ledger);
  const outcome = await resumeAgentLoop(next.deps, paused.resume!);
  assert.notEqual(outcome.status, "awaiting_approval");
  assert.deepEqual(next.ran, ["b"]);
  assert.equal(next.ledger.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call" && event.status === "denied"), true);
});

test("a revise step depending on a failed earlier step is skipped instead of erroring", async () => {
  const h = harness(
    [plan([step("a")]), JSON.stringify({ decision: "revise", steps: [step("r", "t.calc", { dependsOn: ["a"] })] }), complete("Done.")],
    { invoke: async () => ({ kind: "failed", reason: "tool_error" }) },
  );
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.steps.map((s) => `${s.id}:${s.status}`), ["a:failed", "r:skipped"]);
});

test("prepareApproval runs for confirm tools only, between tool_call_started and tool_call_waiting_approval, and never executes the tool", async () => {
  const h = harness([plan([step("a"), step("b", "t.confirm", { dependsOn: ["a"] })])]);
  const order: string[] = [];
  h.deps.prepareApproval = async ({ step: planned, toolCallId }) => {
    order.push(`prepare:${planned.id}:${toolCallId}:last=${h.ledger.at(-1)?.kind}`);
    // Stands in for L9: the runtime appends durable evidence through the same ledger while the call is unapproved.
    await h.deps.ledger!({ kind: "tool_call_execution_prepared", toolCallId, operationDigest: "a".repeat(64), approvalDigest: "b".repeat(64), policyRevision: "c".repeat(64), backendId: "docker-local", backendGenerationId: null });
  };
  const outcome = await runAgentLoop(h.deps);
  assert.equal(outcome.status, "awaiting_approval");
  assert.deepEqual(order, ["prepare:b:b-call:last=tool_call_started"], "only the confirm call, right after its tool_call_started");
  assert.deepEqual(h.ledger.slice(-3).map((event) => event.kind), ["tool_call_started", "tool_call_execution_prepared", "tool_call_waiting_approval"]);
  assert.deepEqual(h.ran, ["a"], "the gated tool is never invoked");
});

test("a failing prepareApproval fails the run visibly and does not pause or invoke anything", async () => {
  const h = harness([plan([step("b", "t.confirm")])]);
  h.deps.prepareApproval = async () => { throw new Error("operation could not be prepared"); };
  await assert.rejects(runAgentLoop(h.deps), /could not be prepared/);
  assert.equal(h.ledger.some((event) => event.kind === "tool_call_waiting_approval"), false);
  assert.deepEqual(h.ran, []);
});

test("prepareApproval is not called again on resume", async () => {
  const h = harness([pausedPlan()]);
  const paused = await runAgentLoop(h.deps);
  const next = harness([complete("Done.")]);
  next.ledger.push(...h.ledger);
  releaseInLedger(next.ledger);
  let calls = 0;
  next.deps.prepareApproval = async () => { calls += 1; };
  await resumeAgentLoop(next.deps, paused.resume!);
  assert.equal(calls, 0);
});

test("registered tool input validation happens before ledger/checkpoint state or invocation", async () => {
  const guarded = tool("t.guarded");
  guarded.validateInput = (input) => input.symbol === "SAFE";
  const h = harness([
    plan([step("a", "t.guarded", { input: { symbol: "REJECT" } })]),
  ], { tools: [guarded], budget: { maxRevisions: 0 } });
  let checkpoints = 0;
  h.deps.checkpoint = async () => { checkpoints += 1; };
  await assert.rejects(runAgentLoop(h.deps), /does not satisfy tool/);
  assert.deepEqual(h.ran, []);
  assert.deepEqual(h.ledger, []);
  assert.equal(checkpoints, 0, "invalid model input never becomes durable restart state");
});
