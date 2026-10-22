import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { observedResearchProgress } from "./observedResearchProgress";
import ResearchRunProgress from "../components/terminal/ResearchRunProgress";

const requestId = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-22T10:00:00Z";
function event(payload: Record<string, unknown>): ConversationRuntimeEvent {
  return { requestId, at, ...payload } as unknown as ConversationRuntimeEvent;
}
function plan(ids = ["fetch", "compare", "write"]): ConversationRuntimeEvent {
  return event({ type: "plan", plan: { steps: ids.map((id) => ({
    id, label: id === "fetch" ? "Fetch source filings" : id,
    kind: "data", permissionClass: "safe_auto",
  })), capabilities: [] } });
}
function result(stepId: string, summary: string, sourceRefs: string[] = []): ConversationRuntimeEvent {
  return event({ type: "tool_result", stepId, label: stepId, summary, deterministic: true, sourceRefs });
}
function markup(events: ConversationRuntimeEvent[], view: "inline" | "findings") {
  return renderToStaticMarkup(createElement(ResearchRunProgress, { events, view }));
}

test("live progress counts only actual completed step events and shows only a reported active label", () => {
  const events = [
    plan(),
    event({ type: "status", stepId: "fetch", state: "queued", message: "Waiting" }),
    event({ type: "tool_start", stepId: "fetch", label: "Fetch source filings", componentId: "retrieve" }),
    result("fetch", "Loaded an observed filing", ["provider:sec_edgar"]),
    event({ type: "tool_start", stepId: "compare", label: "Compare", componentId: "compute" }),
  ];
  assert.deepEqual(observedResearchProgress(events), {
    total: 3, completed: 1, activeLabel: "compare",
    results: [{ stepId: "fetch", label: "Fetch source filings", summary: "Loaded an observed filing", referenceCount: 1 }],
  });
  const html = markup(events, "inline");
  assert.match(html, /data-testid="trace-observed-progress"/);
  assert.match(html, /1 of 3 steps completed/);
  assert.match(html, /compare/);
  assert.doesNotMatch(html, /%|ETA|verified/);
});

test("the latest plan is authoritative; unrelated events, stale findings and queued steps never count", () => {
  const events = [
    plan(), result("fetch", "stale result"),
    plan(["new-step"]),
    result("fetch", "old step should not count"),
    event({ type: "tool_start", stepId: "new-step", label: "Latest", componentId: "retrieve" }),
    event({ type: "status", stepId: "new-step", message: "Cancelled", state: "cancelled" }),
  ];
  assert.deepEqual(observedResearchProgress(events), {
    total: 1, completed: 0, activeLabel: null, results: [],
  });
  assert.equal(observedResearchProgress([result("fetch", "orphan")]), null);
  assert.equal(observedResearchProgress([plan([])]), null);
  assert.equal(markup([], "inline"), "");
});

test("a completed status without a tool_result counts as progress but not a research finding", () => {
  const events = [
    plan(["fetch"]),
    event({ type: "status", stepId: "fetch", state: "completed", message: "Done" }),
  ];
  assert.deepEqual(observedResearchProgress(events), { total: 1, completed: 1, activeLabel: null, results: [] });
  assert.match(markup(events, "findings"), /No completed tool results reported yet/);
});

test("observed findings are bounded, newest first, with only explicitly recorded reference counts", () => {
  const events = [
    plan(["1","2","3","4"]),
    result("1", "First result", ["https://example.com/1", "https://example.com/1"]),
    result("2", "Second result", []),
    result("3", "Third result", ["provider:fred", "provider:sec_edgar"]),
    result("4", "<script>alert('x')</script>", []),
  ];
  const projected = observedResearchProgress(events);
  assert.equal(projected?.completed, 4);
  assert.deepEqual(projected?.results.map((x) => x.stepId), ["4", "3", "2"]);
  assert.equal(projected?.results[1].referenceCount, 2);
  const html = markup(events, "findings");
  assert.match(html, /data-testid="trace-research-findings"/);
  assert.match(html, /4 of 4 steps completed/);
  assert.match(html, /Reported results/);
  assert.match(html, /No source references recorded for this step/);
  assert.match(html, /2 references recorded/);
  assert.doesNotMatch(html, /First result/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /not independently verified conclusions/);
});

test("a restarted step never presents stale results as current evidence", () => {
  const events = [plan(["fetch"]), result("fetch", "old"), event({
    type: "status", stepId: "fetch", state: "running", message: "Retrying",
  })];
  const current = observedResearchProgress(events);
  assert.equal(current?.completed, 0);
  assert.deepEqual(current?.results, []);
  assert.equal(current?.activeLabel, "Fetch source filings");
});
