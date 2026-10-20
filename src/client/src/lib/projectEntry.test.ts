import assert from "node:assert/strict";
import test from "node:test";
import { resolveEntrySurface, resolveInitialChatMode, resolveInitialSelection } from "./projectEntry";

test("no chat and no restorable state opens the composer, not Project Home", () => {
  const selection = resolveInitialSelection(null, { projectId: null, chatId: null });
  assert.deepEqual(selection, { projectId: null, chatId: null });
  assert.equal(resolveInitialChatMode(selection), "quick");
  assert.equal(
    resolveEntrySurface({ chatMode: "quick", chatId: null, projectHomeRequested: false, projectHomeAvailable: false }),
    "conversation",
  );
});

test("a remembered Project without a chat still opens the composer", () => {
  const selection = resolveInitialSelection(null, { projectId: 7, chatId: null });
  assert.equal(resolveInitialChatMode(selection), "project");
  assert.equal(
    resolveEntrySurface({ chatMode: "project", chatId: selection.chatId, projectHomeRequested: false, projectHomeAvailable: true }),
    "conversation",
  );
});

test("a restorable chat is restored, and an address wins over remembered state", () => {
  assert.deepEqual(resolveInitialSelection(null, { projectId: 7, chatId: 42 }), { projectId: 7, chatId: 42 });
  assert.deepEqual(resolveInitialSelection({ projectId: 9, chatId: 5 }, { projectId: 7, chatId: 42 }), { projectId: 9, chatId: 5 });
  assert.equal(
    resolveEntrySurface({ chatMode: "project", chatId: 42, projectHomeRequested: true, projectHomeAvailable: true }),
    "conversation",
  );
});

test("Project Home shows only when explicitly opened with no chat", () => {
  assert.equal(
    resolveEntrySurface({ chatMode: "project", chatId: null, projectHomeRequested: true, projectHomeAvailable: true }),
    "project-home",
  );
  assert.equal(
    resolveEntrySurface({ chatMode: "project", chatId: null, projectHomeRequested: true, projectHomeAvailable: false }),
    "conversation",
  );
  assert.equal(
    resolveEntrySurface({ chatMode: "temporary", chatId: null, projectHomeRequested: true, projectHomeAvailable: true }),
    "conversation",
  );
});
