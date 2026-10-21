import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import { createArtifactVersion, keepConversationDraft } from "./useArtifacts";

const draft: ConversationArtifactDraft = {
  schemaVersion: "1", artifactId: "11111111-1111-4111-8111-111111111111", artifactType: "research_brief",
  title: "Quick analysis", projectId: null, sourceRefs: ["source:owned-note"], executionReceiptIds: [], data: {}, persistence: "chat_candidate",
};

test("Quick Chat retention uses its owning Chat endpoint then edits the same canonical exact revision", async (t) => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const id = `artifact:${draft.artifactId}`;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json(requests.length === 1
      ? { artifact: { id, projectId: null, owningChatId: 42 }, version: { artifactId: id, version: 3 } }
      : { artifactId: id, version: 4 });
  });
  const saved = await keepConversationDraft({ chatId: 42 }, draft, { requestId: "run-owned", dependencyRefs: draft.sourceRefs });
  assert.equal(requests[0].url, "/api/chats/42/artifacts/keep-draft");
  assert.equal("sessionId" in requests[0].body, false, "chat retention never acquires a Project session");
  assert.deepEqual(requests[0].body.draft, draft);
  assert.equal(saved.artifact.projectId, null);
  assert.equal(saved.artifact.owningChatId, 42);
  const edited = await createArtifactVersion(saved.artifact.id, { baseVersion: saved.version.version, content: { kind: "table", columns: [], rows: [] }, actorType: "user" });
  assert.equal(requests[1].url, `/api/artifacts/${encodeURIComponent(id)}/versions`);
  assert.equal(requests[1].body.baseVersion, 3);
  assert.equal(edited.artifactId, id);
  assert.equal(edited.version, 4);
  assert.equal(requests.some(request => request.url.startsWith("/api/projects")), false);
});

test("existing Project retention keeps the existing endpoint and session contract", async (t) => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ artifact: { id: draft.artifactId, projectId: 17 }, version: { version: 1 } });
  });
  await keepConversationDraft(17, { ...draft, projectId: 17, persistence: "project_candidate" }, { sessionId: "existing-session" });
  assert.deepEqual({ url: requests[0].url, sessionId: requests[0].body.sessionId }, { url: "/api/projects/17/artifacts/keep-draft", sessionId: "existing-session" });
});
