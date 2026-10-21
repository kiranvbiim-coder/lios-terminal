import assert from "node:assert/strict";
import test from "node:test";
import { workingContextSnapshotSchema } from "@shared/conversationRuntime";
import { resolveScopedWorkbenchSymbol } from "./chatWorkbenchContext";

function snapshot(scope: "project" | "quick" | "temporary" = "quick", overrides: Record<string, unknown> = {}) {
  return workingContextSnapshotSchema.parse({
    version: 1, scope, projectId: scope === "project" ? 15 : null, chatId: scope === "temporary" ? null : 29,
    turn: 2, updatedAt: "2026-10-21T09:00:00.000Z",
    entities: [{ symbol: "MSFT", source: "message" }], activeArtifact: null,
    selectedElement: null, objective: "Research $MSFT", sourcePosture: "auto",
    assumptionRefs: [], asOf: null, capabilityIds: [], aiPosture: { executionMode: "deterministic_first", providerId: null },
    receiptRefs: [], workspaceSessionRef: null, confidence: 0.95, ...overrides,
  });
}
function quick(metadata: Record<string, unknown> = { workingContext: snapshot() }) {
  return { mode: "quick" as const, projectId: null, chatId: 29,
    messages: [{ role: "user", metadata: {} }, { role: "assistant", metadata }] };
}

test("current signed-off Chat context selects one explicitly resolved security, never background AAPL", () => {
  assert.equal(resolveScopedWorkbenchSymbol(quick()), "MSFT");
  assert.equal(resolveScopedWorkbenchSymbol(quick({ workingContext: snapshot("quick", { entities: [{ symbol: "AAPL", source: "workspace" }] }) })), null);
});

test("real Project and Temporary context use their correct scope without saving Temporary state", () => {
  const project = { mode: "project" as const, projectId: 15, chatId: 29, messages: [{ role: "assistant", metadata: { workingContext: snapshot("project") } }] };
  assert.equal(resolveScopedWorkbenchSymbol(project), "MSFT");
  assert.equal(resolveScopedWorkbenchSymbol({ mode: "temporary", projectId: 15, chatId: 29, messages: [], temporaryContext: snapshot("temporary") }), "MSFT");
  assert.equal(resolveScopedWorkbenchSymbol({ ...project, projectId: 16 }), null);
  assert.equal(resolveScopedWorkbenchSymbol({ ...project, chatId: 30 }), null);
  assert.equal(resolveScopedWorkbenchSymbol({ ...quick(), projectId: 15 }), "MSFT", "Quick owner is never taken from an ambient Project");
});

test("comparisons, general questions and unresolved names do not invent a symbol", () => {
  const compare = snapshot("quick", { entities: [{ symbol: "MSFT", source: "message" }, { symbol: "NVDA", source: "message" }] });
  assert.equal(resolveScopedWorkbenchSymbol(quick({ workingContext: compare })), null);
  assert.equal(resolveScopedWorkbenchSymbol(quick({ workingContext: snapshot("quick", { entities: [] }) })), null);
  assert.equal(resolveScopedWorkbenchSymbol(quick({ workingContext: null })), null);
  assert.equal(resolveScopedWorkbenchSymbol(quick({ workingContext: { entities: [{ symbol: "MSFT" }] } })), null);
});

test("a newer assistant turn cannot borrow an old saved entity, and user prose is not authority", () => {
  const previous = quick();
  assert.equal(resolveScopedWorkbenchSymbol({ ...previous, messages: [...previous.messages, { role: "assistant", metadata: { workingContext: null } }] }), null);
  assert.equal(resolveScopedWorkbenchSymbol({ ...previous, messages: [{ role: "user", metadata: { workingContext: snapshot() } }] }), null);
});
