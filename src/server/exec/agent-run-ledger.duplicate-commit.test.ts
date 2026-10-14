import assert from "node:assert/strict";
import test from "node:test";
import { deriveAgentToolIdempotencyKey } from "./agent-idempotency";
import { AgentLedgerError, assertAgentEventChain, sealAgentEvent, type AgentEventInput, type AgentRunEvent } from "./agent-run-events";

const RUN = "a4444444-4444-4444-8444-444444444444";
const AT = "2026-10-05T00:00:00.000Z";
const HASH = "c".repeat(64);
const KEY = deriveAgentToolIdempotencyKey({ requestId: RUN, stepId: "s1", toolId: "provider.write", inputSha256: HASH });
const WRONG_KEY = deriveAgentToolIdempotencyKey({ requestId: RUN, stepId: "s1", toolId: "provider.write", inputSha256: "d".repeat(64) });

const step: AgentEventInput = { kind: "step_started", stepId: "s1" };
const call = (toolCallId: string, extra: Partial<Extract<AgentEventInput, { kind: "tool_call_started" }>> = {}): AgentEventInput => ({
  kind: "tool_call_started", toolCallId, stepId: "s1", toolId: "provider.write", inputSha256: HASH, decision: "allow", permissionClass: "safe_auto", sideEffect: "external", ...extra,
});
const intent = (toolCallId: string, attempt = 1, key = KEY): AgentEventInput => ({ kind: "tool_call_dispatch_intent", toolCallId, idempotencyKey: key, attempt });
const noEffect = (toolCallId: string, attempt = 1): AgentEventInput => ({ kind: "tool_call_dispatch_no_effect", toolCallId, idempotencyKey: KEY, attempt, reconciliationRef: "reconcile:none" });
const commit = (toolCallId: string, attempt = 1): AgentEventInput => ({ kind: "tool_call_dispatch_committed", toolCallId, idempotencyKey: KEY, attempt, commitRef: "commit:one" });
const finish = (toolCallId: string, status: "succeeded" | "cancelled" | "failed"): AgentEventInput => ({ kind: "tool_call_finished", toolCallId, status, outputRef: null });

function chain(events: AgentEventInput[]): AgentRunEvent[] {
  const sealed: AgentRunEvent[] = [];
  for (const event of events) sealed.push(sealAgentEvent(sealed, event, AT, RUN));
  return sealed;
}
const refused = (events: AgentEventInput[], pattern: RegExp) =>
  assert.throws(() => chain(events), (error: unknown) => error instanceof AgentLedgerError && pattern.test(error.message));

const noEffectThenCancel: AgentEventInput[] = [step, call("c1"), intent("c1"), noEffect("c1"), finish("c1", "cancelled")];

test("a linked retry reuses the key: one no-effect, then exactly one commit, then one successful finish", () => {
  const events = chain([...noEffectThenCancel, call("c2", { resumesToolCallId: "c1" }), intent("c2"), commit("c2"), finish("c2", "succeeded")]);
  assert.doesNotThrow(() => assertAgentEventChain(events, RUN));
});

test("negative controls: wrong key, missing link, other step/tool link, duplicate commit and link to a completed call are refused", () => {
  const linked = call("c2", { resumesToolCallId: "c1" });
  refused([...noEffectThenCancel, linked, intent("c2", 1, WRONG_KEY)], /idempotency key does not match/);
  refused([...noEffectThenCancel, call("c2"), intent("c2")], /must link to the call it continues/);
  refused([...noEffectThenCancel, call("c2", { toolId: "provider.other", resumesToolCallId: "c1" })], /same step, tool and input/);
  refused([step, { kind: "step_started", stepId: "s2" }, call("c1"), intent("c1"), noEffect("c1"), finish("c1", "cancelled"), call("c2", { stepId: "s2", resumesToolCallId: "c1" })], /same step, tool and input/);
  // Duplicate commit: a second call sharing the key cannot commit again, linked or not.
  const committed: AgentEventInput[] = [step, call("c1"), intent("c1"), commit("c1"), finish("c1", "succeeded")];
  refused([...committed, call("c2"), intent("c2")], /already has a committed effect|must link/);
  refused([...committed, call("c2", { resumesToolCallId: "c1" })], /finished cancelled/);
  // Link to a completed (succeeded/failed) call.
  refused([step, call("c1"), intent("c1"), noEffect("c1"), finish("c1", "failed"), call("c2", { resumesToolCallId: "c1" })], /finished cancelled/);
  // The same key cannot commit twice inside one call either.
  refused([step, call("c1"), intent("c1"), commit("c1"), intent("c1", 2)], /committed tool call cannot dispatch again|already has a committed effect/);
});
