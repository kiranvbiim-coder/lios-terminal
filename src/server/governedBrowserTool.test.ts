import assert from "node:assert/strict";
import test from "node:test";
import { getConversationTool, invokeConversationTool, listAgentConversationTools } from "./conversationRuntime";
import { GovernedToolApprovalRequiredError } from "./governedTools";
import { browserTextEvidenceDocuments } from "./governedBrowserTool";

const validInput = {
  urls: ["https://www.sec.gov/edgar"],
  extraction: { kind: "text" as const },
};

test("SI-02 L12 browser capability is a strict-schema governed agent tool", async () => {
  const descriptor = getConversationTool("agent.browser.navigate");
  assert.ok(descriptor);
  assert.equal(descriptor.permissionClass, "user_confirm");
  assert.equal(descriptor.sideEffect, "external");
  assert.equal(descriptor.replaySafe, false);
  assert.ok(listAgentConversationTools().some((tool) => tool.id === descriptor.id));
  assert.equal(descriptor.inputSchema.safeParse(validInput).success, true);
  assert.equal(descriptor.inputSchema.safeParse({ ...validInput, projectId: 999 }).success, false, "trusted Project context is not model input");

  await assert.rejects(
    () => invokeConversationTool(descriptor.id, validInput, new AbortController().signal, {
      source: "agent",
      requestId: "11111111-1111-4111-8111-111111111111",
      userId: 1,
      projectId: 7,
      chatId: 8,
      role: "owner",
      sourceScope: "web",
      stepId: "browse",
      toolCallId: "browse-call",
      planHash: "a".repeat(64),
      runSignal: new AbortController().signal,
    }),
    GovernedToolApprovalRequiredError,
  );
});


test("SI-03.07 web evidence uses resolved URL as citation identity and retains requested source", () => {
  const evidence = browserTextEvidenceDocuments({
    id: "11111111-1111-4111-8111-111111111111",
    adapterId: "lios.playwright.optional",
    projectId: 7,
    outputs: [{ text: "Public filing evidence" }],
    pages: [{
      requestedUrl: "https://example.test/latest",
      resolvedUrl: "https://example.test/archive/filing",
      output: { text: "Public filing evidence" },
    }],
    download: null,
    startedAt: "2026-10-06T09:00:00.000Z",
    completedAt: "2026-10-06T09:00:01.000Z",
    inputHash: "a".repeat(64),
    outputHash: "b".repeat(64),
  }, { kind: "text" });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceRef, "https://example.test/archive/filing");
  assert.deepEqual(evidence[0].sourceRefs, [
    "https://example.test/archive/filing",
    "https://example.test/latest",
  ]);
  assert.equal(evidence[0].metadata.sourceUrl, "https://example.test/archive/filing");
  assert.equal(evidence[0].metadata.requestedUrl, "https://example.test/latest");
  assert.equal(evidence[0].metadata.resolvedUrl, "https://example.test/archive/filing");
  assert.equal(evidence[0].metadata.acquisitionOutputHash, "b".repeat(64));
});
