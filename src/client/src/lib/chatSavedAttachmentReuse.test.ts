import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { savedChatAttachmentRefs, stageSavedAttachmentForFollowUp } from "./chatSavedAttachmentReuse";

const quick = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "document" as const,
  sourceRef: "quick-attachment:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fileName: "research.pdf",
  mimeType: "application/pdf",
  sha256: "a".repeat(64),
  byteLength: 430,
  textPreview: null,
};
const project = {
  ...quick,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sourceRef: "project-attachment:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  fileName: "project-notes.txt",
};

test("only complete, canonical refs in saved message metadata can be offered for reuse", () => {
  assert.deepEqual(savedChatAttachmentRefs(null), []);
  assert.deepEqual(savedChatAttachmentRefs({ attachments: "malformed" }), []);
  assert.deepEqual(savedChatAttachmentRefs({ attachments: [
    quick, project, quick,
    { ...quick, sourceRef: "quick-attachment:not-the-same-id" },
    { ...project, sha256: "spoofed" },
    { id: quick.id, fileName: quick.fileName, byteLength: quick.byteLength },
    { ...quick, sourceRef: "https://example.com/arbitrary-file" },
  ] }), [quick, project]);
  // Old saved messages can still be displayed, but may not be silently reinstated without full identity.
  assert.deepEqual(savedChatAttachmentRefs({ attachments: [{ id: quick.id, fileName: quick.fileName, byteLength: quick.byteLength }] }), []);
});

test("explicit reuse stays within the same five-file composition limit and never mutates its source", () => {
  const fresh = stageSavedAttachmentForFollowUp([], quick, 0);
  assert.equal(fresh.status, "added");
  assert.deepEqual(fresh.refs, [quick]);
  assert.equal(stageSavedAttachmentForFollowUp(fresh.refs, quick, 0).status, "already_staged");
  assert.equal(stageSavedAttachmentForFollowUp([], project, 5).status, "limit_reached");
  assert.equal(stageSavedAttachmentForFollowUp([], project, -1).status, "limit_reached");
  assert.equal(stageSavedAttachmentForFollowUp([], { ...quick, sourceRef: "another-user:" + quick.id }, 0).status, "invalid");
  assert.equal(stageSavedAttachmentForFollowUp([], { ...quick, sha256: "x".repeat(64) }, 0).status, "invalid");
  const additional = stageSavedAttachmentForFollowUp(fresh.refs, project, 0);
  assert.equal(additional.status, "added");
  assert.deepEqual(additional.refs, [quick, project]);
  assert.deepEqual(fresh.refs, [quick], "adding an old file to a follow-up must not modify the previous send");
});

test("composer explicitly stages old file refs, preserving the original download route and source gates", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const shell = fs.readFileSync(path.join(root, "components", "terminal", "ProjectExperienceShell.tsx"), "utf8");
  assert.match(shell, /savedChatAttachmentRefs\(message\.metadata\)/);
  assert.match(shell, /stageSavedAttachmentForFollowUp/);
  assert.match(shell, /Use in next message/);
  assert.match(shell, /disabled=\{busy\}/);
  assert.doesNotMatch(shell, /disabled=\{busy \|\| chatMode === "temporary"\}/, "outer non-Temporary branch already narrows Chat mode");
  assert.match(shell, /sourceScope === "web"/);
  assert.match(shell, /setPendingAttachmentRefs\(result\.refs\)/);
  assert.match(shell, /quick-attachment:/);
  const reuse = fs.readFileSync(path.join(root, "lib", "chatSavedAttachmentReuse.ts"), "utf8");
  assert.match(reuse, /project-attachment:/);
  assert.match(shell, /download=\{attachment\.fileName\}/);
  assert.match(shell, /if \(result\.ok\) setPendingAttachmentRefs\(\[\]\)/,
    "successful sends should clear explicit file selection; user must opt into reuse");
});
