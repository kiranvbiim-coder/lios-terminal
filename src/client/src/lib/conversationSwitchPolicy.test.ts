import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRecentChats, hasUnsentConversationDraft, remainingChatMode } from "./conversationSwitchPolicy";

const draft = (partial: Partial<Parameters<typeof hasUnsentConversationDraft>[0]> = {}) => ({
  text: "", attachmentFiles: 0, attachmentRefs: 0, voiceTranscripts: 0, ...partial,
});
const chat = (id: number, date: string, changes: Partial<{ status: string; trashedAt: string | null; lastActivityAt: string }> = {}) => ({
  id, status: "active", trashedAt: null, lastActivityAt: date, ...changes,
});

test("WS-16 whitespace-only text does not require an unnecessary destructive switch prompt", () => {
  assert.equal(hasUnsentConversationDraft(draft({ text: "   \n" })), false);
  assert.equal(hasUnsentConversationDraft(draft({ text: "Unsent research" })), true);
});

test("WS-16 staged local files, uploaded references and voice transcripts each require consent", () => {
  assert.equal(hasUnsentConversationDraft(draft({ attachmentFiles: 1 })), true);
  assert.equal(hasUnsentConversationDraft(draft({ attachmentRefs: 1 })), true);
  assert.equal(hasUnsentConversationDraft(draft({ voiceTranscripts: 1 })), true);
});

test("WS-16 archive/trash of a quick conversation returns to quick—not an unowned Project mode", () => {
  assert.equal(remainingChatMode(null), "quick");
  assert.equal(remainingChatMode(8), "project");
  assert.equal(remainingChatMode(0), "project");
});

test("WS-16 mixed recents are descending and remain isolated to active non-trashed chats", () => {
  const list = canonicalRecentChats([
    chat(1, "2026-10-10T09:00:00Z"),
    chat(2, "2026-10-20T09:00:00Z", { status: "archived" }),
    chat(3, "2026-10-21T09:00:00Z", { trashedAt: "2026-10-21T09:10:00Z" }),
  ], [chat(4, "2026-10-22T09:00:00Z")]);
  assert.deepEqual(list.map(c => c.id), [4, 1]);
});

test("WS-16 duplicated Quick chats from multiple queries appear once", () => {
  const saved = [chat(15, "2026-10-19T09:00:00Z")];
  const quick = [chat(15, "2026-10-22T09:00:00Z")];
  const result = canonicalRecentChats(saved, quick);
  assert.equal(result.length, 1);
  assert.equal(result[0].lastActivityAt, "2026-10-22T09:00:00Z");
});

test("WS-16 recents never fabricate dates when one server timestamp is invalid", () => {
  assert.deepEqual(canonicalRecentChats([chat(1, "invalid"), chat(2, "2026-10-20T09:00:00Z")], []).map(c => c.id), [2, 1]);
});

test("WS-16 recents have a deterministic limit and stable tie-break", () => {
  const t = "2026-10-20T09:00:00Z";
  assert.deepEqual(canonicalRecentChats([chat(1,t),chat(3,t),chat(2,t)],[],2).map(c => c.id), [3,2]);
  assert.deepEqual(canonicalRecentChats([chat(1,t)],[],0), []);
});

test("WS-16 empty or all-archived recents resolve to a truthful empty list", () => {
  assert.deepEqual(canonicalRecentChats([], []), []);
  assert.deepEqual(canonicalRecentChats([chat(4,"2026-10-20T09:00:00Z",{status:"archived"})], []), []);
});
