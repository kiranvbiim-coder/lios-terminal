import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_POLICY_CLASS,
  AGENT_ROLE_REGISTRY,
  aiTransmissionPolicySchema,
  conversationContextEnvelopeSchema,
  conversationRequestSchema,
  conversationCapabilityMatchSchema,
  conversationSourceScopeSchema,
  conversationRuntimeEventSchema,
  governedToolReviewDecisionSchema,
  workflowPlanSchema,
} from "./conversationRuntime";

test("P2 context envelope enforces Project scope instead of leaking Project ids into Quick Chat", () => {
  const base = {
    schemaVersion: "1" as const,
    identity: { userId: 7, organizationId: null, role: "internal_user" },
    project: { projectId: null, name: null, instructionIncluded: false, resourceRefs: [] },
    conversation: { chatId: 9, scope: "quick" as const, branchId: null },
    workspace: { sessionId: null, view: "chart", symbol: "AAPL" },
    active: { objectRefs: ["security:AAPL"], selection: null },
  };
  assert.equal(conversationContextEnvelopeSchema.safeParse(base).success, true);
  assert.equal(conversationContextEnvelopeSchema.safeParse({
    ...base,
    project: { ...base.project, projectId: 42 },
  }).success, false);
});

test("P2 Project AI transmission policy rejects contradictory provider allow/deny rules", () => {
  assert.equal(aiTransmissionPolicySchema.safeParse({
    providerAllow: ["openai"],
    providerDeny: ["OpenAI"],
  }).success, false);
  assert.equal(aiTransmissionPolicySchema.safeParse({
    mode: "local_only",
    allowResourceReferences: false,
    allowSelection: false,
    allowToolCalling: false,
  }).success, true);
});

test("P2 action classes keep material mutations behind confirmation", () => {
  assert.equal(ACTION_POLICY_CLASS.OpenPanel, "safe_auto");
  assert.equal(ACTION_POLICY_CLASS.InspectSource, "safe_auto");
  assert.equal(ACTION_POLICY_CLASS.ChangeAssumption, "user_confirm");
  assert.equal(ACTION_POLICY_CLASS.RunValuation, "user_confirm");
  assert.equal(ACTION_POLICY_CLASS.RunBacktest, "user_confirm");
  assert.equal(ACTION_POLICY_CLASS.AIDirectEstimate, "user_confirm");
});

test("P2 Agent Runtime exposes the canonical replaceable specialist roles", () => {
  assert.deepEqual(AGENT_ROLE_REGISTRY, [
    "research",
    "fundamental",
    "valuation",
    "quant",
    "technical",
    "macro",
    "portfolio",
    "risk",
    "backtest",
    "filing_document",
    "data",
    "reporting",
  ]);
});

test("P2 approval continuations and waiting state are typed", () => {
  const requestId = "4fe3b0e4-eae8-4a0e-849c-06d7d7996c36";
  const continuationOf = "31eb0f73-7907-49c3-888b-4de04600fbf6";
  const parsed = conversationRequestSchema.parse({
    requestId,
    continuationOf,
    message: "estimate a DCF",
    executionMode: "ai_direct",
    aiDirectApproved: true,
    approvals: [{ action: "AIDirectEstimate", scope: "once" }],
  });
  assert.equal(parsed.continuationOf, continuationOf);
  assert.equal(conversationRuntimeEventSchema.safeParse({
    type: "done",
    requestId,
    at: new Date().toISOString(),
    status: "waiting_approval",
  }).success, true);
});


test("SI-02 governed-tool review decisions are one canonical closed vocabulary", () => {
  for (const decision of ["allow_once", "allow_project", "deny"] as const) {
    assert.equal(governedToolReviewDecisionSchema.parse(decision), decision);
  }
  assert.equal(governedToolReviewDecisionSchema.safeParse("allow_forever").success, false);
  assert.equal(governedToolReviewDecisionSchema.safeParse("tool:lios.test.send").success, false);
});

test("SI-02 governed-tool approval exposes only opaque review identity and bounded display metadata", () => {
  const requestId = "8d970384-f6de-45bd-a9b2-64f10d38d978";
  const reviewId = "d1e0ff74-4f66-4cf7-85f8-bf9e7b865ce8";
  const event = {
    type: "governed_tool_approval_required" as const,
    requestId,
    at: new Date().toISOString(),
    reviewId,
    label: "Send result",
    permissionClass: "user_confirm" as const,
    choices: ["allow_once", "allow_project", "deny"] as const,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    message: "Approve this governed tool to continue the same run.",
  };
  assert.equal(conversationRuntimeEventSchema.safeParse(event).success, true);

  for (const leaked of [
    { toolId: "lios.test.send" },
    { input: { secret: "never expose" } },
    { inputSha256: "a".repeat(64) },
    { planHash: "b".repeat(64) },
    { stepId: "step-send" },
    { toolCallId: "private-call" },
    { policyRevision: "c".repeat(64) },
    { authorization: { fake: true } },
  ]) {
    assert.equal(conversationRuntimeEventSchema.safeParse({ ...event, ...leaked }).success, false);
  }

  assert.equal(conversationRuntimeEventSchema.safeParse({ ...event, reviewId: "not-a-review-id" }).success, false);
  assert.equal(conversationRuntimeEventSchema.safeParse({ ...event, label: "" }).success, false);
  assert.equal(conversationRuntimeEventSchema.safeParse({ ...event, expiresAt: "not-a-date" }).success, false);
});

test("P2 Review / Apply / Cancel mutation proposal is typed", () => {
  const requestId = "5a0cb330-d600-4450-b352-d49c25c0ff5d";
  assert.equal(conversationRuntimeEventSchema.safeParse({
    type: "mutation_review",
    requestId,
    at: new Date().toISOString(),
    proposal: {
      mutationId: "a4d08334-0e2a-4ac5-a64b-61106e77429e",
      action: "ChangeAssumption",
      summary: "Change terminal growth from 3.0% to 3.5%.",
      reversible: true,
      before: { terminalGrowth: 0.03 },
      after: { terminalGrowth: 0.035 },
    },
    choices: ["review", "apply", "cancel"],
  }).success, true);
});


test("P2 data-gap events are structured and actionable without invented values", () => {
  const requestId = "9a4cfce4-6416-4ca4-b4d0-971908453a5f";
  const parsed = conversationRuntimeEventSchema.parse({
    type: "data_gap",
    requestId,
    at: new Date().toISOString(),
    gap: {
      field: "market_data",
      message: "Market data is unavailable from connected sources.",
      reason: "unavailable",
      providersChecked: ["connected market-data providers"],
      nextActions: [
        "Connect a compatible market-data provider",
        "Import historical data",
      ],
    },
  });
  assert.equal(parsed.type, "data_gap");
  if (parsed.type === "data_gap") {
    assert.equal(parsed.gap.reason, "unavailable");
    assert.equal(parsed.gap.nextActions.length, 2);
  }
});


test("P1C authenticated composer source scopes are explicit and default to Auto", () => {
  for (const scope of ["auto", "my_data", "web", "files"] as const) {
    assert.equal(conversationSourceScopeSchema.parse(scope), scope);
  }
  const request = conversationRequestSchema.parse({
    requestId: "fe3b4145-2f2f-4802-bafd-1a72e8e31e93",
    message: "Research Apple",
  });
  assert.equal(request.sourceScope, "auto");

  const filesOnly = conversationRequestSchema.parse({
    requestId: "5c03b4f6-2f9e-4d0a-9050-18a953ad4f0d",
    message: "Summarize the attached files",
    sourceScope: "files",
  });
  assert.equal(filesOnly.sourceScope, "files");
});


test("Active P2 capability matches are typed and provider/framework neutral", () => {
  const match = conversationCapabilityMatchSchema.parse({
    id: "security.overview",
    label: "Build security overview",
    confidence: 0.93,
    reason: "Natural-language security research request.",
    entityQuery: "Apple",
    permissionClass: "safe_auto",
    requiresDeterministicCompute: true,
    sourceKinds: ["connected"],
  });
  assert.equal(match.id, "security.overview");
  assert.equal(match.symbol, null);
  assert.equal(match.availability, "ready");
  assert.deepEqual(match.requiredInputs, []);
  assert.deepEqual(match.missingInputs, []);
  assert.equal(match.sourceScopeCompatible, true);
  assert.equal(match.sourceScopeReason, null);
  assert.equal(match.requiresAI, false);
  assert.deepEqual(match.parameters, {});
});

test("Active P2 WorkflowPlan keeps capability metadata backward-compatible", () => {
  const plan = workflowPlanSchema.parse({
    schemaVersion: "1",
    requestId: "2199e3d4-f01d-414d-9180-f589775b17c1",
    intent: {
      action: "chat",
      confidence: 0.8,
      entityRefs: [],
      parameters: {},
      requiresAI: true,
      requiresDeterministicCompute: false,
    },
    steps: [{
      id: "ai-assist",
      kind: "ai",
      label: "Ask configured BYOAI provider",
      componentId: "lios.byoai",
      permissionClass: "safe_auto",
      dependsOn: [],
    }],
    budget: { maxSteps: 12, maxDurationMs: 90_000, maxAiCalls: 2 },
  });
  assert.deepEqual(plan.capabilities, []);
});
