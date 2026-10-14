import assert from "node:assert/strict";
import test from "node:test";
import { AgentLedgerError, assertAgentEventChain, projectAgentLedger, sealAgentEvent, type AgentEventInput, type AgentRunEvent } from "./agent-run-events";

const RUN = "a3333333-3333-4333-8333-333333333333";
const AT = "2026-10-05T00:00:00.000Z";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const step = (stepId: string): AgentEventInput => ({ kind: "step_started", stepId });
const call = (toolCallId: string, stepId: string, extra: Partial<Extract<AgentEventInput, { kind: "tool_call_started" }>> = {}): AgentEventInput => ({
  kind: "tool_call_started", toolCallId, stepId, toolId: "provider.write", inputSha256: HASH, decision: "allow", permissionClass: "safe_auto", sideEffect: "none", ...extra,
});
const cancelled = (toolCallId: string): AgentEventInput => ({ kind: "tool_call_finished", toolCallId, status: "cancelled", outputRef: null });

function chain(events: AgentEventInput[]): AgentRunEvent[] {
  const sealed: AgentRunEvent[] = [];
  for (const event of events) sealed.push(sealAgentEvent(sealed, event, AT, RUN));
  return sealed;
}
const refused = (events: AgentEventInput[], pattern: RegExp) =>
  assert.throws(() => chain(events), (error: unknown) => error instanceof AgentLedgerError && pattern.test(error.message));

test("a resumed call links to the one cancelled call of the same step, tool and input; the old call is never reopened", () => {
  const events = chain([step("s1"), call("c1", "s1"), cancelled("c1"), call("c2", "s1", { resumesToolCallId: "c1" })]);
  assert.doesNotThrow(() => assertAgentEventChain(events, RUN));
  assert.deepEqual(projectAgentLedger(events, RUN).calls.map((item) => [item.toolCallId, item.phase]), [["c1", "finished"], ["c2", "started"]]);
  // A chain of resumes links each call to its immediate predecessor.
  assert.doesNotThrow(() => chain([step("s1"), call("c1", "s1"), cancelled("c1"), call("c2", "s1", { resumesToolCallId: "c1" }), cancelled("c2"), call("c3", "s1", { resumesToolCallId: "c2" })]));
});

test("a link to a missing call, itself, another step, another tool or input, an open, succeeded or already-resumed call is refused", () => {
  refused([step("s1"), call("c1", "s1", { resumesToolCallId: "ghost" })], /existing earlier call/);
  refused([step("s1"), call("c1", "s1", { resumesToolCallId: "c1" })], /existing earlier call/);
  refused([step("s1"), step("s2"), call("c1", "s1"), cancelled("c1"), call("c2", "s2", { resumesToolCallId: "c1" })], /same step, tool and input/);
  refused([step("s1"), call("c1", "s1"), cancelled("c1"), call("c2", "s1", { toolId: "provider.other", resumesToolCallId: "c1" })], /same step, tool and input/);
  refused([step("s1"), call("c1", "s1"), cancelled("c1"), call("c2", "s1", { inputSha256: OTHER_HASH, resumesToolCallId: "c1" })], /same step, tool and input/);
  refused([step("s1"), call("c1", "s1"), call("c2", "s1", { resumesToolCallId: "c1" })], /finished cancelled/);
  refused([step("s1"), call("c1", "s1"), { kind: "tool_call_finished", toolCallId: "c1", status: "succeeded", outputRef: "tool-result:x" }, call("c2", "s1", { resumesToolCallId: "c1" })], /finished cancelled/);
  refused([step("s1"), call("c1", "s1"), { kind: "tool_call_finished", toolCallId: "c1", status: "failed", outputRef: null }, call("c2", "s1", { resumesToolCallId: "c1" })], /finished cancelled/);
  refused([step("s1"), call("c1", "s1"), cancelled("c1"), call("c2", "s1", { resumesToolCallId: "c1" }), cancelled("c2"), call("c3", "s1", { resumesToolCallId: "c1" })], /already resumed/);
});

test("the link field is a bounded opaque id, never free text", () => {
  assert.throws(() => sealAgentEvent([], { ...call("c1", "s1"), resumesToolCallId: "has spaces and secret=1" }, AT, RUN), AgentLedgerError);
});
