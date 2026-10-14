import assert from "node:assert/strict";
import test from "node:test";
import { planConversationWorkflow } from "./conversationRuntime";
import { DEFAULT_AI_TRANSMISSION_POLICY } from "@shared/conversationRuntime";

test("P4 active Artifact spreadsheet instruction routes to governed proposal without AI", () => {
  const plan = planConversationWorkflow({
    requestId: "11111111-1111-4111-8111-111111111111",
    continuationOf: null,
    message: "set B4 to 0.09",
    executionMode: "deterministic_first",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: DEFAULT_AI_TRANSMISSION_POLICY,
    context: { activeObjectRefs: ["artifact:22222222-2222-4222-8222-222222222222"] },
  });
  assert.equal(plan.intent.action, "edit_artifact");
  assert.equal(plan.intent.requiresAI, false);
  assert.equal(plan.steps[0].componentId, "lios.artifact-proposal");
  assert.equal((plan.intent.parameters.artifactEdit as any).cellRef, "B4");
});

test("P4 active Artifact top-level field instruction creates an edit plan", () => {
  const plan = planConversationWorkflow({
    requestId: "33333333-3333-4333-8333-333333333333",
    continuationOf: null,
    message: "set field objective to Improve risk-adjusted return",
    executionMode: "deterministic_first",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: DEFAULT_AI_TRANSMISSION_POLICY,
    context: { activeObjectRefs: ["artifact:44444444-4444-4444-8444-444444444444"] },
  });
  assert.equal(plan.intent.action, "edit_artifact");
  assert.equal((plan.intent.parameters.artifactEdit as any).field, "objective");
});

test("named research subject is not replaced by a pronoun in a later analysis instruction", () => {
  const plan = planConversationWorkflow({
    requestId: "55555555-5555-4555-8555-555555555555", continuationOf: null,
    message: "Research Microsoft Corporation using permitted sources. Resolve its canonical entity and preserve source truth.",
    executionMode: "deterministic_first", aiDirectApproved: false, approvals: [],
    transmissionPolicy: DEFAULT_AI_TRANSMISSION_POLICY,
  });
  assert.ok(plan.capabilities.some(capability => capability.entityQuery === "Microsoft Corporation"));
  assert.ok(!JSON.stringify(plan).includes('"ITS"'));
});
