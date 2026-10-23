import assert from "node:assert/strict";
import test from "node:test";
import {
  P1_SHELL_TELEMETRY_PRIVACY_CONTRACT,
  deriveP1ShellLoadState,
  isComposerFocusShortcut,
  P1_SOURCE_SCOPES,
  resolveComposerPersistenceTarget,
  sourceScopeForChatMode,
} from "./p1Shell";

test("P1C source-scope chips are the canonical authenticated composer set", () => {
  assert.deepEqual(P1_SOURCE_SCOPES.map((scope) => scope.id), ["auto", "my_data", "web", "files"]);
});

test("Temporary scope never inherits unavailable file posture or mutates saved scope choices", () => {
  for (const scope of ["auto", "my_data", "web", "files"] as const) {
    assert.equal(sourceScopeForChatMode("quick", scope), scope);
    assert.equal(sourceScopeForChatMode("project", scope), scope);
    assert.equal(sourceScopeForChatMode("temporary", scope), scope === "my_data" || scope === "files" ? "auto" : scope);
  }
});

test("P1C Cmd/Ctrl+K converges on the composer without hijacking Alt shortcuts", () => {
  assert.equal(isComposerFocusShortcut({ key: "k", metaKey: true }), true);
  assert.equal(isComposerFocusShortcut({ key: "K", ctrlKey: true }), true);
  assert.equal(isComposerFocusShortcut({ key: "k", metaKey: true, altKey: true }), false);
  assert.equal(isComposerFocusShortcut({ key: "p", metaKey: true }), false);
});

test("P1C shell loading/error/empty states are deterministic", () => {
  assert.equal(deriveP1ShellLoadState({
    projectsLoading: true, projectsError: false, projectHomeLoading: false, projectHomeError: false,
    messagesLoading: false, messagesError: false, projectCount: 0, projectSelected: false, chatSelected: false,
  }), "loading");
  assert.equal(deriveP1ShellLoadState({
    projectsLoading: false, projectsError: true, projectHomeLoading: false, projectHomeError: false,
    messagesLoading: false, messagesError: false, projectCount: 0, projectSelected: false, chatSelected: false,
  }), "error");
  assert.equal(deriveP1ShellLoadState({
    projectsLoading: false, projectsError: false, projectHomeLoading: false, projectHomeError: false,
    messagesLoading: false, messagesError: false, projectCount: 0, projectSelected: false, chatSelected: false,
  }), "empty");
  assert.equal(deriveP1ShellLoadState({
    projectsLoading: false, projectsError: false, projectHomeLoading: false, projectHomeError: false,
    messagesLoading: false, messagesError: false, projectCount: 1, projectSelected: true, chatSelected: false,
  }), "ready");
});

test("P1C shell telemetry stores counters only and explicitly excludes user content", () => {
  assert.deepEqual(P1_SHELL_TELEMETRY_PRIVACY_CONTRACT, {
    localOnly: true,
    storesPromptText: false,
    storesFileNames: false,
    storesFileContents: false,
    storesProjectNames: false,
    storesClientNames: false,
    storesSymbols: false,
    storesProviderCredentials: false,
    storesOnlyCountersAndSourceScopeIds: true,
  });
});


test("P1C clean install never requires a Project before the first authenticated question", () => {
  assert.equal(resolveComposerPersistenceTarget({ chatMode: "project", projectId: null, chatId: null }), "quick");
  assert.equal(resolveComposerPersistenceTarget({ chatMode: "quick", projectId: null, chatId: null }), "quick");
  assert.equal(resolveComposerPersistenceTarget({ chatMode: "project", projectId: 42, chatId: null }), "project");
  assert.equal(resolveComposerPersistenceTarget({ chatMode: "project", projectId: 42, chatId: 99 }), "existing");
  assert.equal(resolveComposerPersistenceTarget({ chatMode: "temporary", projectId: null, chatId: null }), "temporary");
});
