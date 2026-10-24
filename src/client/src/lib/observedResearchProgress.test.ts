import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { observedResearchProgress } from "./observedResearchProgress";

const event = (type: string, extra = {}, requestId = "current") => ({ type, requestId, at: "2026-10-23T00:00:00Z", ...extra }) as ConversationRuntimeEvent;
const plan = (requestId = "current") => event("plan", { plan: { steps: [{ id: "fetch", label: "Fetch" }], capabilities: [] } }, requestId);
const result = (summary: string, requestId = "current") => event("tool_result", { stepId: "fetch", label: "Fetch", summary, sourceRefs: [] }, requestId);

test("another request cannot replace the current plan or contribute matching step results", () => {
  const progress = observedResearchProgress([plan(), result("foreign", "other"), plan("other")], "current");
  assert.deepEqual(progress, { total: 1, completed: 0, activeLabels: [], results: [] });
  assert.equal(observedResearchProgress([plan()], null), null);
});

test("retry then status-only completion never resurrects the prior attempt's finding", () => {
  const events = [plan(), result("stale"), event("tool_start", { stepId: "fetch" }), event("status", { stepId: "fetch", state: "completed" })];
  assert.deepEqual(observedResearchProgress(events, "current"), { total: 1, completed: 1, activeLabels: [], results: [] });
  events.push(result("fresh"));
  assert.equal(observedResearchProgress(events, "current")?.results[0].summary, "fresh");
});

test("replanning discards prior results and queued/cancelled steps are not running", () => {
  const events = [plan(), result("old"), plan(), event("status", { stepId: "fetch", state: "queued" })];
  assert.deepEqual(observedResearchProgress(events, "current"), { total: 1, completed: 0, activeLabels: [], results: [] });
  events.push(event("tool_start", { stepId: "fetch" }));
  assert.deepEqual(observedResearchProgress(events, "current")?.activeLabels, ["Fetch"]);
  events.push(event("status", { stepId: "fetch", state: "cancelled" }));
  assert.deepEqual(observedResearchProgress(events, "current")?.activeLabels, []);
});
