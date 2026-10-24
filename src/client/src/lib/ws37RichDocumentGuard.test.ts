import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const rich = readFileSync(new URL("../components/terminal/RichArtifactDocumentEditor.tsx", import.meta.url), "utf8");
const pane = readFileSync(new URL("../components/terminal/ArtifactPane.tsx", import.meta.url), "utf8");

test("WS-37 user-authored report inserts reconcile canonical sections without a second document store", () => {
  assert.match(rich, /reconcileReportBlockSections\(knownSections\.current, savedBlockIds\.current, decoded\.blocks\.map\(block => block\.id\)\)/);
  assert.match(rich, /if \(next\.kind === "report"\) knownSections\.current = next\.sections/);
  assert.match(rich, /savedBlockIds\.current = content\.blocks\.map\(block => block\.id\)/);
  assert.match(rich, /knownSections\.current = content\.kind === "report" \? content\.sections : \[\]/);
  assert.match(rich, /fromTiptapDocumentProjection\(projection, canonical\)/);
  assert.doesNotMatch(rich, /localStorage|persistConversationDraft|createArtifactVersion/);
});

test("WS-37 save UI stays read-only and conflicts never bypass governed canonical P4 revision", () => {
  assert.match(pane, /if \(disabled \|\| recovery\.blocked \|\| saving \|\| pending \|\| conflict \|\| pendingContent\.current !== null\) throw new Error/);
  assert.match(pane, /<fieldset disabled=\{disabled \|\| advancedDirty \|\| recovery\.blocked\}/);
  assert.match(pane, /disabled=\{disabled \|\| saving \|\| pending \|\| conflict\} value=\{block\.text\}/);
  assert.match(pane, /data-testid="save-document-revision" disabled=\{disabled \|\| !dirty \|\| saving \|\| pending \|\| conflict \|\| advancedDirty \|\| recovery\.blocked\}/);
  assert.match(pane, /<JsonEditor key=\{baseRevision\} content=\{draftContent\} disabled=\{disabled \|\| saving \|\| pending \|\| conflict \|\| recovery\.blocked\}/);
  assert.match(pane, /createArtifactVersion\(artifactId, \{ baseVersion: data\.version\.version, content: next, actorType: "user" \}\)/);
  assert.match(pane, /document-revision-conflict/);
  assert.match(pane, /useNativeArtifactDraftRecovery/);
});

test("WS-37 pasted HTML or ungoverned foreign blocks are not imported to the canonical editor", () => {
  assert.match(rich, /event\.clipboardData\?\.getData\("text\/plain"\)/);
  assert.match(rich, /event\.preventDefault\(\)/);
  assert.match(rich, /handleDrop\(_view, event\) \{ event\.preventDefault\(\); return true; \}/);
  assert.match(rich, /editor\.commands\.setContent\(editableProjection\(content\), \{ emitUpdate: false, errorOnInvalidContent: true \}\)/);
  assert.match(rich, /aria-label="Document formatting"/);
});
