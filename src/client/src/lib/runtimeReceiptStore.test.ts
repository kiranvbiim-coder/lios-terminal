import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { compactReceiptEvents, loadRuntimeReceipt, saveRuntimeReceipt } from "./runtimeReceiptStore";

const requestId = "00000000-0000-4000-8000-000000000001";
const at = "2026-09-30T07:00:00.000Z";
const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
};
const result = (stepId: string): ConversationRuntimeEvent => ({ type: "tool_result", requestId, at, stepId, label: "Quote", summary: "ok", deterministic: true, sourceRefs: ["provider:yahoo"] });
const done = (status: "completed" | "waiting_approval"): ConversationRuntimeEvent => ({ type: "done", requestId, at, status });

test("finished runs keep only step events and never answer text", () => {
  const text: ConversationRuntimeEvent = { type: "text", requestId, at, text: "secret answer", label: "deterministic" };
  const kept = compactReceiptEvents([result("a"), text, done("completed")]);
  assert.deepEqual(kept.map((e) => e.type), ["tool_result", "done"]);
});

test("runs waiting for approval or unfinished are not stored", () => {
  assert.deepEqual(compactReceiptEvents([result("a")]), []);
  assert.deepEqual(compactReceiptEvents([result("a"), done("waiting_approval")]), []);
});

test("receipt round-trips per chat and tolerates corrupt storage", () => {
  const storage = memory();
  saveRuntimeReceipt(7, [result("a"), done("completed")], storage);
  assert.equal(loadRuntimeReceipt(7, storage).length, 2);
  assert.deepEqual(loadRuntimeReceipt(8, storage), []);
  storage.map.set("lios.runtime-receipt.v1.9", "{not json");
  assert.deepEqual(loadRuntimeReceipt(9, storage), []);
  assert.deepEqual(loadRuntimeReceipt(7, null), []);
});

test("old chats are evicted beyond the cap", () => {
  const storage = memory();
  for (let id = 1; id <= 65; id += 1) saveRuntimeReceipt(id, [result("a"), done("completed")], storage);
  assert.deepEqual(loadRuntimeReceipt(1, storage), []);
  assert.equal(loadRuntimeReceipt(65, storage).length, 2);
});
