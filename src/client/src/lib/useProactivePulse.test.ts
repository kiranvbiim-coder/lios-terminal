import test from "node:test";
import assert from "node:assert/strict";

import { parseActionInboxResponse } from "./useProactivePulse";

const asOf = "2026-10-27T05:15:00.000Z";
const item = (id: string, status: "open" | "snoozed" | "resolved" = "open") => ({
  id, sourceCardId: `card:${id}`, title: "Attribution present",
  reason: "Review source before changing anything.",
  priority: "important" as const, suggestedActions: ["investigate"], createdAt: asOf,
  status, evidence: [{ id: `evidence:${id}`, source: "Original provider" }],
});
const envelope = (items: ReturnType<typeof item>[]) => ({
  items, asOf, status: items.some(value => value.status === "open") ? "needs_attention" : "caught_up",
});

test("ambient proactive badge counts ONLY open, source-valid entitled action inbox items", () => {
  assert.deepEqual(parseActionInboxResponse(envelope([item("1"), item("2", "resolved"), item("3", "snoozed")])),
    { count: 1, status: "ready" });
});

test("ambient proactive badge distinguishes a valid empty inbox from unavailable", () => {
  assert.deepEqual(parseActionInboxResponse(envelope([])), { count: 0, status: "ready" });
  assert.deepEqual(parseActionInboxResponse(null), { count: 0, status: "unavailable" });
  assert.deepEqual(parseActionInboxResponse({ asOf, items: [] }), { count: 0, status: "unavailable" });
});

test("ambient proactive badge refuses malformed or contradictory state instead of an all-clear", () => {
  assert.deepEqual(parseActionInboxResponse("not an object"), { count: 0, status: "unavailable" });
  assert.deepEqual(parseActionInboxResponse([1, 2, 3]), { count: 0, status: "unavailable" });
  assert.deepEqual(parseActionInboxResponse({ asOf, items: [item("1")], status: "caught_up" }), { count: 0, status: "unavailable" });
  assert.deepEqual(parseActionInboxResponse({ asOf, items: [{ id: "1" }], status: "needs_attention" }), { count: 0, status: "unavailable" });
});
