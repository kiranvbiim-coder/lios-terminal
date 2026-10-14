import assert from "node:assert/strict";
import test from "node:test";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import { executeConversationRuntime, includedResourceRefs } from "./conversationRuntime";

const attachment = {
  id: "54a0ff87-2f66-4fd1-a9f4-b39d4af46f67",
  kind: "document" as const,
  sourceRef: "project-attachment:54a0ff87-2f66-4fd1-a9f4-b39d4af46f67",
  fileName: "memo.txt",
  mimeType: "text/plain",
  sha256: "a".repeat(64),
  byteLength: 20,
  textPreview: null,
};

const autoResource = {
  id: "resource:auto",
  kind: "reference",
  label: "Company model",
  resourceRef: "project-resource:model",
  contextMode: "project" as const,
};

const fileResource = {
  id: "resource:file",
  kind: "chat_attachment",
  label: "memo.txt",
  resourceRef: attachment.sourceRef,
  contextMode: "on_demand" as const,
};

test("P1C source-scope defaults are backwards-compatible", () => {
  const request = conversationRequestSchema.parse({
    requestId: "e7e4fba6-125a-4f4a-84e3-642667552e29",
    message: "Research Apple",
  });
  assert.equal(request.sourceScope, "auto");
});

test("P1C Web scope never silently includes Project resources or files", () => {
  assert.deepEqual(
    includedResourceRefs([autoResource, fileResource], "Use @Company_model and the memo", [attachment], "web"),
    [],
  );
});

test("P1C Files scope includes only explicitly attached files", () => {
  assert.deepEqual(
    includedResourceRefs([autoResource, fileResource], "Use @Company_model and the memo", [attachment], "files"),
    [fileResource],
  );
});

test("P1C My Data scope can include Project-auto and explicitly attached resources", () => {
  assert.deepEqual(
    includedResourceRefs([autoResource, fileResource], "Use the memo", [attachment], "my_data"),
    [autoResource, fileResource],
  );
});


test("P1C incompatible My Data market request fails as a data gap before any tool retrieval", async () => {
  const events: any[] = [];
  const request = conversationRequestSchema.parse({
    requestId: "a74dccbe-5de3-4d7c-a2fc-64d4d85bbb0b",
    message: "technical analysis AAPL with RSI and MACD",
    sourceScope: "my_data",
    context: { symbol: "AAPL" },
  });
  await assert.rejects(() => executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 10,
    projectId: null,
    resources: [],
    history: [],
    request,
    emit: (event) => { events.push(event); },
  }), /does not permit external\/connected market data/);
  assert.equal(events.some((event) => event.type === "data_gap" && event.gap?.field === "source_scope"), true);
  assert.equal(events.some((event) => event.type === "tool_start"), false);
});

test("P1C source-scope failure precedes governed backtest approval", async () => {
  const events: any[] = [];
  const request = conversationRequestSchema.parse({
    requestId: "b3a195ef-6cb1-46ec-b090-e54b7cce8330",
    message: "backtest RSI strategy on AAPL",
    sourceScope: "my_data",
    context: { symbol: "AAPL" },
  });
  await assert.rejects(() => executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 11,
    projectId: null,
    resources: [],
    history: [],
    request,
    emit: (event) => { events.push(event); },
  }), /does not permit external\/connected market data/);
  assert.equal(events.some((event) => event.type === "data_gap"), true);
  assert.equal(events.some((event) => event.type === "approval_required"), false);
});
