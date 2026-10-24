import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { inspectAgentReceiptActivity, receiptPresentation } from "./agentReceiptActivity";

const REQUEST = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-10-24T10:00:00.000Z";
const makeEvent = (body: Record<string, unknown>, requestId = REQUEST): ConversationRuntimeEvent =>
  ({ requestId, at: DATE, ...body }) as unknown as ConversationRuntimeEvent;
const makeReceipt = (overrides: Record<string, unknown> = {}) => ({
  id: "44444444-4444-4444-8444-444444444444", requestId: REQUEST,
  componentId: "agent.research", operation: "read_source", status: "completed",
  startedAt: DATE, completedAt: DATE, deterministic: true, aiDerived: false,
  inputHash: "a".repeat(64), outputHash: "b".repeat(64), 
  sourceRefs: ["secret-signed-source-uri:do-not-render"],
  warnings: ["Sensitive provider diagnostic: do not render"],
  inputEvidence: { apiKey: "SHOULD_NEVER_BE_DISPLAYED" },
  outputEvidence: { raw: "PRIVATE_RESULT" },
  ...overrides,
});

test("tool-result-only progress is not misrepresented as an execution receipt", () => {
  const activity = inspectAgentReceiptActivity([
    makeEvent({ type: "tool_start", stepId: "step-1", label: "Search", componentId: "provider.search" }),
    makeEvent({ type: "tool_result", stepId: "step-1", label: "Search", summary: "Found one citation", deterministic: true, sourceRefs: [] }),
    makeEvent({ type: "done", status: "completed" }),
  ], REQUEST);
  assert.equal(activity.observedSteps, 1);
  assert.equal(activity.lastStepLabel, "Search");
  assert.equal(activity.receipts.length, 0);
  assert.equal(activity.completed, 0);
  assert.equal(activity.hasReceiptProblems, false);
});

test("only same-run matching receipts are counted; duplicate and foreign events cannot add approval", () => {
  const good = makeReceipt();
  const another = makeReceipt({ id: "55555555-5555-4555-8555-555555555555", status: "failed" });
  const differentInnerRun = makeReceipt({ id: "66666666-6666-4666-8666-666666666666", requestId: OTHER, status: "completed" });
  const activity = inspectAgentReceiptActivity([
    makeEvent({ type: "receipt", receipt: good }),
    makeEvent({ type: "receipt", receipt: good }),
    makeEvent({ type: "receipt", receipt: another }),
    makeEvent({ type: "receipt", receipt: differentInnerRun }),
    makeEvent({ type: "receipt", receipt: makeReceipt({ id: "77777777-7777-4777-8777-777777777777" }) }, OTHER),
  ], REQUEST);
  assert.equal(activity.receipts.length, 2);
  assert.equal(activity.completed, 1);
  assert.equal(activity.failed, 1);
  assert.equal(activity.cancelled, 0);
  assert.equal(activity.mismatched, 1);
  assert.equal(activity.hasReceiptProblems, true);
  assert.deepEqual(activity.receipts.map(receipt => receipt.id), [good.id, another.id]);
});

test("cancelled records are not completed, and null run identity falls back to event stream run", () => {
  const activity = inspectAgentReceiptActivity([makeEvent({ type: "receipt", receipt: makeReceipt({ status: "cancelled" }) })], null);
  assert.equal(activity.requestId, REQUEST);
  assert.equal(activity.completed, 0);
  assert.equal(activity.cancelled, 1);
  assert.equal(activity.hasReceiptProblems, true);
  assert.deepEqual(inspectAgentReceiptActivity([], null).receipts, []);
});

test("receipt presentation exposes only safe derived summary labels, never raw evidence or source URIs", () => {
  const raw = makeReceipt();
  const presentation = receiptPresentation(raw as never);
  assert.deepEqual(presentation, {
    operation: "read source", component: "agent.research", status: "completed",
    kind: "Deterministic", sourceCount: 1, hasInputHash: true, hasOutputHash: true,
    warnings: 1,
  });
  const serialized = JSON.stringify(presentation);
  assert.ok(!serialized.includes("SHOULD_NEVER_BE_DISPLAYED"));
  assert.ok(!serialized.includes("PRIVATE_RESULT"));
  assert.ok(!serialized.includes("do-not-render"));
  assert.ok(!serialized.includes("Sensitive provider diagnostic"));
  assert.equal(receiptPresentation(makeReceipt({ deterministic: false, aiDerived: true }) as never).kind, "AI-derived");
  assert.equal(receiptPresentation(makeReceipt({ deterministic: false, aiDerived: false }) as never).kind, "Unclassified");
});
