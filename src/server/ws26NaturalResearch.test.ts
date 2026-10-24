import assert from "node:assert/strict";
import test from "node:test";
import { createAttribution } from "./byoaiRouter";
import { executeConversationRuntime, planConversationWorkflow } from "./conversationRuntime";
import type { ConversationRequest } from "@shared/conversationRuntime";

const baseline: ConversationRequest = {
  requestId: "c361c4c9-ad77-4a9e-9934-a9957bb21428",
  continuationOf: null,
  message: "Research battery recycling in India",
  sourceScope: "web",
  executionMode: "ai_assisted",
  aiDirectApproved: false,
  approvals: [],
  attachments: [],
  transmissionPolicy: {
    mode: "configured",
    providerAllow: [],
    providerDeny: [],
    allowProjectInstructions: true,
    allowResourceReferences: true,
    allowSelection: true,
    allowToolCalling: true,
    dataClassification: "public",
  },
};

test("WS-26 plain-language research publishes a bounded truthful AI plan", () => {
  const plan = planConversationWorkflow(baseline);
  assert.equal(plan.intent.action, "research");
  assert.equal(plan.intent.parameters.workflow, "ws26_natural_research");
  assert.equal(plan.intent.parameters.objective, "battery recycling in India");
  assert.equal(plan.intent.requiresAI, true);
  assert.equal(plan.intent.requiresDeterministicCompute, false);
  assert.deepEqual(plan.steps.map((step) => step.id), ["ai-assist"]);
  assert.equal(plan.budget.maxSteps, 1);
  assert.equal(plan.budget.maxAiCalls, 1);
  assert.equal(plan.budget.maxDurationMs, 60_000);
  assert.deepEqual(plan.capabilities.map((capability) => capability.id), ["ai.answer"]);
});

test("WS-26 does not replace specialized finance routing or generic chat", () => {
  const specialized = planConversationWorkflow({ ...baseline, message: "technical analysis AAPL with RSI and MACD" });
  assert.equal(specialized.intent.action, "calculate");
  const ordinary = planConversationWorkflow({ ...baseline, message: "Explain photosynthesis" });
  assert.equal(ordinary.intent.action, "chat");
});

test("WS-26 emits the real run plan and keeps one observed BYOAI call separate from source retrieval", async () => {
  const observed: Array<{ type: string; [key: string]: unknown }> = [];
  let aiCalls = 0;
  let systemPrompt = "";
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "temporary",
    chatId: null,
    projectId: null,
    history: [],
    resources: [],
    request: baseline,
    aiCompletion: async (input) => {
      aiCalls += 1;
      systemPrompt = input.system;
      return {
        provider: "openai",
        model: "configured-test-model",
        text: "The available context does not independently verify this topic.",
        attribution: createAttribution({ provider: "openai", model: "configured-test-model", prompt: "research test", output: "The available context does not independently verify this topic." }),
      };
    },
    emit: (event) => { observed.push(event as unknown as (typeof observed)[number]); },
  });
  assert.equal(aiCalls, 1);
  assert.equal(result.plan.intent.action, "research");
  assert.match(systemPrompt, /No browser or connected provider retrieval is executed by this plan/);
  assert.match(systemPrompt, /Never fabricate citations/);
  assert.match(result.text, /No external sources were retrieved by this workflow/);
  assert.equal(result.artifacts.length, 0);
  const plans = observed.filter((event) => event.type === "plan");
  assert.equal(plans.length, 1);
  assert.equal((plans[0].plan as { intent: { action: string } }).intent.action, "research");
  assert.deepEqual(observed.filter((event) => event.type === "tool_start").map((event) => event.stepId), ["ai-assist"]);
  assert.equal(observed.some((event) => event.type === "receipt"), true);
});
