import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMemoryNotePage, memoryNoteDraftIsDirty, memoryNoteEditorReducer, MemoryNoteRequestError,
  reviewedMemoryNoteRequest, saveReviewedMemoryNote,
} from "../components/terminal/ProjectMemoryNotesEditor";
import type { ProjectMemoryNote } from "@shared/projectMemoryNotes";

const note: ProjectMemoryNote = {
  memoryKey: "owner:quoted /?雪", revision: 1, content: "Historical original",
  createdAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z",
};
const literal = '  Owner “quote” 雪 🧭\n<script>alert("not instructions")</script> & <img src=x onerror=alert(1)>  ';

test("owner-note write → review → back/cancel never creates a request until exact text review", () => {
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "create" });
  assert.equal(memoryNoteDraftIsDirty(editor), false);
  editor = memoryNoteEditorReducer(editor, { type: "change", content: literal });
  assert.equal(memoryNoteDraftIsDirty(editor), true);
  assert.equal(reviewedMemoryNoteRequest(editor), null);
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  assert.deepEqual(reviewedMemoryNoteRequest(editor), { method: "POST", suffix: "", body: { content: literal, reviewed: true } });
  editor = memoryNoteEditorReducer(editor, { type: "back" });
  assert.equal(reviewedMemoryNoteRequest(editor), null);
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  editor = memoryNoteEditorReducer(editor, { type: "change", content: "Changed after preview" });
  assert.equal(reviewedMemoryNoteRequest(editor), null, "editing invalidates the previous exact preview");
  editor = memoryNoteEditorReducer(editor, { type: "clear" });
  assert.equal(reviewedMemoryNoteRequest(editor), null);
});

test("blank, NUL and over-limit notes cannot reach reviewed requests; Unicode/markup stays literal", () => {
  for (const content of ["", " \n\t", "unsafe\u0000note", "x".repeat(4001)]) {
    let editor = memoryNoteEditorReducer(null, { type: "open", intent: "create" });
    editor = memoryNoteEditorReducer(editor, { type: "change", content });
    editor = memoryNoteEditorReducer(editor, { type: "review" });
    assert.equal(editor?.phase, "write");
    assert.equal(reviewedMemoryNoteRequest(editor), null);
  }
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "create" });
  editor = memoryNoteEditorReducer(editor, { type: "change", content: "雪".repeat(4000) });
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  assert.deepEqual(reviewedMemoryNoteRequest(editor)?.body, { content: "雪".repeat(4000), reviewed: true });
});

test("conflict preserves draft and original revision until explicit current-revision review", () => {
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "edit", note });
  editor = memoryNoteEditorReducer(editor, { type: "change", content: literal });
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  assert.deepEqual(reviewedMemoryNoteRequest(editor), {
    method: "PATCH", suffix: `/${encodeURIComponent(note.memoryKey)}`,
    body: { content: literal, expectedRevision: 1, reviewed: true },
  });
  editor = memoryNoteEditorReducer(editor, { type: "conflict" });
  assert.equal(editor?.content, literal);
  assert.equal(reviewedMemoryNoteRequest(editor), null);
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  assert.equal(reviewedMemoryNoteRequest(editor), null, "retrying the previous preview cannot bypass conflict");
  const newer = { ...note, revision: 2, content: "Another window saved this" };
  editor = memoryNoteEditorReducer(editor, { type: "current", note: newer });
  assert.equal(editor?.note?.revision, 1, "loading current content does not silently rebase");
  assert.equal(editor?.content, literal);
  assert.equal(reviewedMemoryNoteRequest(editor), null);
  editor = memoryNoteEditorReducer(editor, { type: "acceptCurrent" });
  assert.deepEqual(reviewedMemoryNoteRequest(editor)?.body, { content: literal, expectedRevision: 2, reviewed: true });
  assert.equal(editor?.phase, "review");
});

test("missing or mismatched current notes never silently recreate or overwrite a conflicted note", () => {
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "edit", note });
  editor = memoryNoteEditorReducer(editor, { type: "change", content: literal });
  editor = memoryNoteEditorReducer(editor, { type: "conflict" });
  for (const current of [null, { ...note, memoryKey: "different-note", revision: 3 }]) {
    editor = memoryNoteEditorReducer(editor, { type: "current", note: current });
    editor = memoryNoteEditorReducer(editor, { type: "acceptCurrent" });
    assert.equal(editor?.content, literal);
    assert.equal(editor?.note?.revision, 1);
    assert.equal(reviewedMemoryNoteRequest(editor), null);
  }
});

test("delete confirmation binds the displayed revision and reconfirms changes without content/provenance", () => {
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "delete", note });
  assert.equal(memoryNoteDraftIsDirty(editor), false);
  assert.deepEqual(reviewedMemoryNoteRequest(editor), {
    method: "DELETE", suffix: `/${encodeURIComponent(note.memoryKey)}`, body: { expectedRevision: 1, reviewed: true },
  });
  editor = memoryNoteEditorReducer(editor, { type: "conflict" });
  editor = memoryNoteEditorReducer(editor, { type: "current", note: { ...note, revision: 3 } });
  assert.equal(reviewedMemoryNoteRequest(editor), null);
  editor = memoryNoteEditorReducer(editor, { type: "acceptCurrent" });
  assert.deepEqual(reviewedMemoryNoteRequest(editor)?.body, { expectedRevision: 3, reviewed: true });
  editor = memoryNoteEditorReducer(editor, { type: "clear" });
  assert.equal(reviewedMemoryNoteRequest(editor), null, "cancel deletes nothing");
});

test("409 and other API failures are safe and leave the exact reviewed draft available", async t => {
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "edit", note });
  editor = memoryNoteEditorReducer(editor, { type: "change", content: literal });
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  const snapshot = structuredClone(editor);
  for (const status of [409, 400, 404, 500, 503]) {
    t.mock.method(globalThis, "fetch", async () => new Response("SECRET arbitrary backend error <script>bad</script>", { status }));
    await assert.rejects(saveReviewedMemoryNote(41, editor, new AbortController().signal), (cause: unknown) => {
      assert.ok(cause instanceof MemoryNoteRequestError);
      assert.equal(cause.conflict, status === 409);
      assert.equal(cause.message.includes("SECRET"), false);
      assert.equal(cause.message.includes("<script>"), false);
      return true;
    });
    assert.deepEqual(editor, snapshot);
    t.mock.restoreAll();
  }
});

test("malformed successful API bodies and network errors never expose server text", async t => {
  let editor = memoryNoteEditorReducer(null, { type: "open", intent: "create" });
  editor = memoryNoteEditorReducer(editor, { type: "change", content: literal });
  editor = memoryNoteEditorReducer(editor, { type: "review" });
  for (const response of [
    () => new Response("SECRET non-JSON response"),
    () => Response.json({ note: { content: "SECRET invalid note" } }),
    () => { throw new Error("SECRET network failure"); },
  ]) {
    t.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(saveReviewedMemoryNote(41, editor, new AbortController().signal), (cause: unknown) => {
      assert.ok(cause instanceof MemoryNoteRequestError);
      assert.equal(cause.message.includes("SECRET"), false);
      return true;
    });
    await assert.rejects(loadMemoryNotePage(41, null, new AbortController().signal), { message: "Project notes are unavailable. Try refreshing notes." });
    t.mock.restoreAll();
  }
});
