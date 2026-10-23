import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { followUpPrompts, formatDuration, humanizeSourceRef, summarizeRuntimeTrace } from "./runtimeTraceSummary";

const id = "11111111-1111-4111-8111-111111111111";
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 30, 10, 0, seconds)).toISOString();
const plan = (capabilityIds: string[], stepIds: string[]): ConversationRuntimeEvent => ({
  requestId: id, at: at(0), type: "plan",
  plan: { capabilities: capabilityIds.map((capId) => ({ id: capId })), steps: stepIds.map((stepId) => ({ id: stepId, label: stepId, kind: "retrieve", permissionClass: "safe_auto", dependsOn: [] })) },
} as never);
const result = (stepId: string, seconds: number, summary = "ok", sourceRefs: string[] = []): ConversationRuntimeEvent =>
  ({ requestId: id, at: at(seconds), type: "tool_result", stepId, label: stepId, summary, deterministic: true, sourceRefs }) as never;
const done = (status: string, seconds: number): ConversationRuntimeEvent => ({ requestId: id, at: at(seconds), type: "done", status }) as never;

test("source references become readable data-source names; AI, engine and model refs are not sources", () => {
  assert.equal(humanizeSourceRef("provider:sec_edgar"), "SEC EDGAR");
  assert.equal(humanizeSourceRef("provider:finnhub"), "Finnhub");
  assert.equal(humanizeSourceRef("lios:global-instrument-master"), "Global Instrument Master");
  assert.equal(humanizeSourceRef("ai-provider:openai"), null);
  assert.equal(humanizeSourceRef("engine:technical"), null);
  assert.equal(humanizeSourceRef("model:python.advanced@1.0.0"), null);
  assert.equal(humanizeSourceRef(""), null);
});

test("a finished research run summarizes steps, sources, time and the resolved symbol", () => {
  const events = [
    plan(["company.research"], ["resolve-security", "retrieve-market-data", "emit-artifact"]),
    result("resolve-security", 1, "apple → AAPL · entity unknown", ["lios:global-instrument-master"]),
    result("retrieve-market-data", 3, "186 bars", ["provider:finnhub", "provider:sec_edgar", "provider:finnhub"]),
    result("emit-artifact", 4),
    done("completed", 5),
  ];
  const summary = summarizeRuntimeTrace(events, false);
  assert.equal(summary.status, "completed");
  assert.equal(summary.stepCount, 3);
  assert.equal(summary.settledSteps, 3);
  assert.deepEqual(summary.sources, ["Global Instrument Master", "Finnhub", "SEC EDGAR"]);
  assert.equal(summary.durationMs, 5000);
  assert.equal(summary.resolvedSymbol, "AAPL");
});

test("a run that stops on a governed gap is 'needs_input', not 'failed'; a real error is 'failed'", () => {
  const gap = { requestId: id, at: at(1), type: "data_gap", gap: {} } as never;
  assert.equal(summarizeRuntimeTrace([plan([], []), gap, done("failed", 2)], false).status, "needs_input");
  const error = { requestId: id, at: at(1), type: "error", message: "boom", code: "runtime_failed" } as never;
  assert.equal(summarizeRuntimeTrace([plan([], []), gap, error, done("failed", 2)], false).status, "failed");
  assert.equal(summarizeRuntimeTrace([done("cancelled", 1)], false).status, "cancelled");
  assert.equal(summarizeRuntimeTrace([plan([], [])], true).status, "running");
  assert.equal(summarizeRuntimeTrace([], false).status, "idle");
});

test("follow-ups only offer requests the router completes, and only after a completed run with a resolved symbol", () => {
  const base = { stepCount: 1, settledSteps: 1, sources: [], durationMs: 1, status: "completed" as const };
  assert.deepEqual(
    followUpPrompts({ ...base, resolvedSymbol: "AAPL", capabilityIds: ["company.research"] }),
    ["Show RSI and MACD for AAPL", "Backtest an RSI strategy on AAPL"],
  );
  assert.deepEqual(
    followUpPrompts({ ...base, resolvedSymbol: "MSFT", capabilityIds: ["market.technical"] }),
    ["Research MSFT", "Backtest an RSI strategy on MSFT"],
  );
  assert.deepEqual(followUpPrompts({ ...base, resolvedSymbol: "AAPL", capabilityIds: ["company.research", "strategy.backtest", "market.technical"] }), []);
  assert.deepEqual(followUpPrompts({ ...base, resolvedSymbol: null, capabilityIds: ["company.research"] }), []);
  assert.deepEqual(followUpPrompts({ ...base, status: "needs_input", resolvedSymbol: "AAPL", capabilityIds: ["company.research"] }), []);
  assert.deepEqual(followUpPrompts({ ...base, resolvedSymbol: "AAPL", capabilityIds: ["ai.answer"] }), []);
});

test("durations read naturally", () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(0), "1 ms");
  assert.equal(formatDuration(420), "420 ms");
  assert.equal(formatDuration(1500), "1.5 s");
  assert.equal(formatDuration(42_000), "42 s");
});

test("WS-22 a detached or interrupted run with no observed done is never reported as running or completed", () => {
  assert.equal(summarizeRuntimeTrace([plan([],["fetch"])],false).status,"interrupted");
  assert.equal(summarizeRuntimeTrace([plan([],["fetch"]), result("fetch",1)],false).status,"interrupted");
  assert.equal(summarizeRuntimeTrace([plan([],["fetch"])],true).status,"running");
});
test("WS-22 only observed Home done marks completion, denial, failure or approval pause", () => {
  assert.equal(summarizeRuntimeTrace([done("completed",2)],false).status,"completed");
  assert.equal(summarizeRuntimeTrace([done("cancelled",2)],false).status,"cancelled");
  assert.equal(summarizeRuntimeTrace([done("failed",2)],false).status,"failed");
  assert.equal(summarizeRuntimeTrace([done("waiting_approval",2)],false).status,"needs_input");
});
