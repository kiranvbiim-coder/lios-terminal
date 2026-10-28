import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { exactRuntimeSavedArtifact, isCurrentSavedArtifactHandoff } from "./exactRuntimeSavedArtifact";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const ARTIFACT = "artifact:22222222-2222-4222-8222-222222222222";
const savedEvent = {
  type: "artifact", requestId: REQUEST, at: "2026-10-28T04:00:00Z",
  artifact: { projectId: 12, title: "Recorded evidence", artifactType: "research_brief" },
  persistedArtifact: { id: ARTIFACT, version: 4 },
} as ConversationRuntimeEvent;
const owner = { requestId: REQUEST, projectId: 12, chatId: 10 };

test("C06 preserves the exact persisted P4 revision and owning request", () => {
  assert.deepEqual(exactRuntimeSavedArtifact(savedEvent, owner), {
    artifactId: ARTIFACT, version: 4, projectId: 12, requestId: REQUEST,
  });
});

test("C06 blocks foreign Project, unsaved, imaginary, malformed and wrong-run pointers", () => {
  assert.equal(exactRuntimeSavedArtifact(savedEvent, { ...owner, chatId: null }), null);
  assert.equal(exactRuntimeSavedArtifact(savedEvent, { ...owner, projectId: 13 }), null);
  assert.equal(exactRuntimeSavedArtifact(savedEvent, { ...owner, requestId: "other" }), null);
  assert.equal(exactRuntimeSavedArtifact(savedEvent, { ...owner, chatId: 0 }), null);
  for (const value of [
    null,
    { ...savedEvent, persistedArtifact: undefined },
    { ...savedEvent, persistedArtifact: { id: "artifact:bad", version: 4 } },
    { ...savedEvent, persistedArtifact: { id: ARTIFACT, version: 0 } },
    { ...savedEvent, persistedArtifact: { id: ARTIFACT, version: 1.5 } },
    { ...savedEvent, type: "text" },
  ]) {
    assert.equal(exactRuntimeSavedArtifact(value as ConversationRuntimeEvent | null, owner), null);
  }
});

test("C06 delayed confirmation cannot cross a Project, Chat or newer run boundary", () => {
  const saved = exactRuntimeSavedArtifact(savedEvent, owner);
  assert.ok(saved);
  const original = { projectId: 12, chatId: 10 };
  assert.equal(isCurrentSavedArtifactHandoff(saved, original, original, REQUEST), true);
  assert.equal(isCurrentSavedArtifactHandoff(saved, original, { projectId: 13, chatId: 10 }, REQUEST), false);
  assert.equal(isCurrentSavedArtifactHandoff(saved, original, { projectId: 12, chatId: 11 }, REQUEST), false);
  assert.equal(isCurrentSavedArtifactHandoff(saved, original, original, "new-run"), false);
  assert.equal(isCurrentSavedArtifactHandoff(saved, original, { projectId: 12, chatId: null }, REQUEST), false);
});

test("C06 chat-scoped saved version stays chat-scoped and never becomes a Project pointer", () => {
  const quick = {
    ...savedEvent, artifact: { projectId: null, title: "Recorded evidence", artifactType: "research_brief" },
  };
  const result = exactRuntimeSavedArtifact(quick, { requestId: REQUEST, projectId: null, chatId: 10 });
  assert.equal(result?.projectId, null);
  assert.equal(exactRuntimeSavedArtifact(quick, owner), null);
});
