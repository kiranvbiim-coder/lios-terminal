import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { AIProviderError } from "./byoaiRouter";
import { executeConversationRuntime, listAgentConversationTools, listConversationTools, planConversationWorkflow } from "./conversationRuntime";

for (const goal of [
  "Find permitted office accessibility documents and save a cited evidence digest.",
  "Compare the onboarding checklist with the incident response procedure in this Project.",
  "Locate the warehouse maintenance schedule and identify missing inspection records.",
]) {
  test(`general-purpose agent planning preserves the non-finance goal: ${goal}`, async () => {
    const request = {
      requestId: crypto.randomUUID(), continuationOf: null, message: goal,
      executionMode: "ai_assisted" as const, aiDirectApproved: false, approvals: [], attachments: [],
      sourceScope: "my_data" as const,
      transmissionPolicy: {
        mode: "configured" as const, providerAllow: [], providerDeny: [], allowProjectInstructions: true,
        allowResourceReferences: false, allowSelection: true, allowToolCalling: true, dataClassification: "private" as const,
      },
    };
    const events: ConversationRuntimeEvent[] = [];
    const prompts: Array<{ system: string; user: string }> = [];
    const available = listAgentConversationTools();
    assert.ok(available.some((tool) => tool.id === "lios.project.search" && tool.inputSchema && tool.outputSchema));
    const crossSearch = available.find((tool) => tool.id === "lios.project.cross_search");
    assert.ok(crossSearch && crossSearch.inputSchema && crossSearch.outputSchema);
    assert.equal(crossSearch.permissionClass, "user_confirm");
    assert.equal(crossSearch.sideEffect, "none");
    assert.equal(crossSearch.replaySafe, true);
    assert.equal(crossSearch.inputSchema.safeParse({ query: "policy", projectIds: [4, 5] }).success, true);
    assert.equal(crossSearch.inputSchema.safeParse({ query: "policy", projectIds: [] }).success, false);
    await assert.rejects(executeConversationRuntime({
      tenant: { userId: 7, organizationId: null, role: "internal_analyst" },
      scope: "project", projectId: 3, chatId: 2, resources: [], history: [], request,
      agentLoop: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0 },
      aiCompletion: async (completion) => {
        prompts.push({ system: completion.system ?? "", user: completion.messages.map((message) => message.content).join("\n") });
        // Capture the real planner boundary; intentionally unavailable, not a fabricated AI completion.
        throw new AIProviderError("not_configured", "No AI provider is configured.");
      },
      emit: (event) => { events.push(event); },
    }));
    assert.equal(prompts.length, 1, "no finance ticker-resolution fallback or extra synthesis call");
    assert.ok(prompts[0].user.includes(goal), "original non-finance goal reaches the production planner unchanged");
    assert.match(prompts[0].system, /lios\.project\.search/);
    assert.equal(events.some((event) => event.type === "tool_start"), false);
    const gap = events.find((event) => event.type === "data_gap");
    assert.ok(gap && gap.type === "data_gap");
    assert.equal(gap.gap.field, "ai_provider", "unavailability is not misclassified as a missing ticker");
    assert.equal(events.some((event) => event.type === "text" || event.type === "artifact"), false);
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(planConversationWorkflow(request).intent.entityRefs, []);
  });
}

test("the Project evidence digest tool is a strict, non-replay-safe internal write exposed to the agent planner", () => {
  const tool = listAgentConversationTools().find((candidate) => candidate.id === "lios.project.evidence_artifact");
  assert.ok(tool, "registered in the builtin conversation registry");
  assert.equal(tool.sideEffect, "internal_write");
  assert.equal(tool.replaySafe, false);
  assert.ok(tool.inputSchema && tool.outputSchema);
  assert.equal(tool.inputSchema.safeParse({ query: "q", title: "t", extra: 1 }).success, false, "unknown keys are rejected");
  assert.equal(tool.inputSchema.safeParse({ query: "q", title: "t" }).success, true);
  assert.equal(listConversationToolsIds().filter((id) => id === tool.id).length, 1, "registered exactly once");
});

function listConversationToolsIds(): string[] {
  return listConversationTools().map((tool) => tool.id);
}
