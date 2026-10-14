import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxSessionBookmark, saveSandboxSessionBookmark } from "./sandboxSessionBookmarkStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("sandbox execution bookmarks restore only the latest server-issued UUID for the same Project and Chat", () => {
  const storage = memoryStorage();
  const first = "550e8400-e29b-41d4-a716-446655440098";
  const second = "550e8400-e29b-41d4-a716-446655440099";
  saveSandboxSessionBookmark(31, 42, first, storage);
  assert.equal(loadSandboxSessionBookmark(31, 42, storage), first);
  assert.equal(loadSandboxSessionBookmark(31, 43, storage), null);
  assert.equal(loadSandboxSessionBookmark(32, 42, storage), null);

  saveSandboxSessionBookmark(31, 42, second, storage);
  assert.equal(loadSandboxSessionBookmark(31, 42, storage), second);
});

test("malformed local bookmarks are discarded and never become server authorization", () => {
  const storage = memoryStorage();
  storage.setItem("lios.sandbox-session.v1.31.42", "not-a-session-id");
  assert.equal(loadSandboxSessionBookmark(31, 42, storage), null);
  assert.equal(storage.getItem("lios.sandbox-session.v1.31.42"), null);
  assert.equal(loadSandboxSessionBookmark(0, 42, storage), null);
});
