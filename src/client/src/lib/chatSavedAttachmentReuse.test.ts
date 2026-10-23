import assert from "node:assert/strict";
import test from "node:test";
import { savedChatAttachmentRefs, stageSavedAttachmentForFollowUp } from "./chatSavedAttachmentReuse";
import type { ConversationAttachmentRef } from "@shared/conversationRuntime";
const reference: ConversationAttachmentRef = { id: "11111111-1111-4111-8111-111111111111", kind: "document", sourceRef: "quick-attachment:11111111-1111-4111-8111-111111111111", fileName: "owned.txt", mimeType: "text/plain", sha256: "a".repeat(64), byteLength: 12, textPreview: null };
test("saved references reject display-only and forged custody references and deduplicate canonical identity", () => {
  assert.deepEqual(savedChatAttachmentRefs({ attachments: [reference, reference, { ...reference, sourceRef: "provider:secret" }, { id: reference.id, fileName: reference.fileName }] }), [reference]);
  assert.deepEqual(savedChatAttachmentRefs(null), []);
  const { textPreview: _notPersisted, ...persisted } = reference;
  assert.deepEqual(savedChatAttachmentRefs({ attachments: [persisted] }), [reference], "Canonical saved-message metadata omits the optional preview content.");
});
test("explicit staging preserves file cap and original selection without silently adding duplicates", () => {
  const existing: ConversationAttachmentRef[] = [];
  assert.deepEqual(stageSavedAttachmentForFollowUp(existing, reference, 4), { status: "added", refs: [reference] });
  assert.deepEqual(existing, []);
  assert.equal(stageSavedAttachmentForFollowUp([], reference, 5).status, "limit_reached");
  assert.equal(stageSavedAttachmentForFollowUp([], reference, -1).status, "limit_reached");
  assert.equal(stageSavedAttachmentForFollowUp([reference], reference, 0).status, "already_staged");
  assert.equal(stageSavedAttachmentForFollowUp([], { ...reference, sourceRef: "quick-attachment:wrong" }, 0).status, "invalid");
});
