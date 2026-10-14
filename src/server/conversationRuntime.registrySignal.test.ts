import assert from "node:assert/strict";
import test from "node:test";
import { cancelConversationExecution, executeConversationRuntime } from "./conversationRuntime";
import { createAttribution } from "./byoaiRouter";

const request = (requestId: string) => ({
  requestId,
  continuationOf: null,
  message: "Summarize the attached file.",
  executionMode: "ai_assisted" as const,
  aiDirectApproved: false,
  approvals: [],
  transmissionPolicy: {
    mode: "configured" as const,
    providerAllow: [],
    providerDeny: [],
    allowProjectInstructions: true,
    allowResourceReferences: false,
    allowSelection: true,
    allowToolCalling: true,
    dataClassification: "private" as const,
  },
  attachments: [],
});

const base = (requestId: string, signal: AbortSignal | undefined, calls: string[]) => ({
  tenant: { userId: 7, organizationId: null, role: "internal_analyst" as const },
  scope: "project" as const,
  chatId: 2,
  projectId: 3,
  resources: [],
  history: [],
  request: request(requestId),
  signal,
  aiCompletion: async () => {
    calls.push("ai");
    return {
      provider: "openai" as const,
      model: "gpt-4o",
      text: "answer",
      attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "t", output: "answer" }),
    };
  },
  emit: () => undefined,
});

test("a run whose registry signal is already aborted is cancelled without calling the model", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  const result = await executeConversationRuntime(base("44444444-4444-4444-8444-444444444444", controller.signal, calls));
  assert.equal(result.cancelled, true);
  assert.deepEqual(calls, []);
});

test("without a registry signal the runtime behaves as before", async () => {
  const calls: string[] = [];
  const result = await executeConversationRuntime(base("55555555-5555-4555-8555-555555555555", undefined, calls));
  assert.equal(result.cancelled, false);
  assert.deepEqual(calls, ["ai"]);
  assert.equal(cancelConversationExecution("55555555-5555-4555-8555-555555555555", 7), false);
});
