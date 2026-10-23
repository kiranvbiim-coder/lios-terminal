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

test("the verified symbol opens a distinct existing entity tab without changing earlier Workbench tabs", async () => {
  const { createInitialTabsState, openEntityTab } = await import("./terminalTabs");
  const { captureChatWorkbenchOrigin } = await import("./chatWorkbenchHandoff");
  const before = createInitialTabsState();
  const symbol = resolveScopedWorkbenchSymbol(quick());
  const origin = captureChatWorkbenchOrigin("quick", null, 29, symbol);
  assert.deepEqual(origin, { mode: "quick", projectId: null, chatId: 29, symbol: "MSFT" });
  const opened = openEntityTab(before, origin.symbol!);
  assert.equal(opened.tabs.length, before.tabs.length + 1);
  assert.deepEqual(opened.tabs[0], before.tabs[0]);
  assert.equal(opened.tabs.find(tab => tab.id === opened.activeTabId)?.workspace.primary.symbol, "MSFT");
  assert.equal(captureChatWorkbenchOrigin("quick", null, 29, "invalid symbol").symbol, undefined);
});

test("a new user question supersedes any previous assistant financial symbol before its answer", () => {
  const prior = quick();
  const askingAnything = {
    ...prior,
    messages: [...prior.messages, { role: "user", metadata: {} }],
  };
  assert.equal(resolveScopedWorkbenchSymbol(askingAnything), null,
    "general Workspace must not inherit an old financial entity while the user's new turn is unanswered");
  assert.equal(resolveScopedWorkbenchSymbol({
    ...askingAnything,
    messages: [...askingAnything.messages, { role: "tool", metadata: { workingContext: snapshot() } }],
  }), null, "tool events cannot restore an old symbol or mint authoritative navigation context");
  assert.equal(resolveScopedWorkbenchSymbol({
    ...askingAnything,
    messages: [...askingAnything.messages, { role: "assistant", metadata: { workingContext: snapshot() } }],
  }), "MSFT", "only a fresh assistant turn with correctly scoped Working Context may select its entity");
});

test("the latest unanswered turn in a Project never falls back to its previous assistant ticker", () => {
  const prior = { mode: "project" as const, projectId: 15, chatId: 29,
    messages: [{ role: "assistant", metadata: { workingContext: snapshot("project") } }] };
  assert.equal(resolveScopedWorkbenchSymbol(prior), "MSFT");
  assert.equal(resolveScopedWorkbenchSymbol({ ...prior, messages: [
    ...prior.messages, { role: "user", metadata: { workingContext: snapshot("project") } },
  ] }), null, "user metadata cannot become navigation/source authority");
  assert.equal(resolveScopedWorkbenchSymbol({ ...prior, messages: [
    ...prior.messages, { role: "user", metadata: {} }, { role: "assistant", metadata: { workingContext: null } },
  ] }), null, "unresolved recent assistant responses must not silently fall back");
});

test("Temporary Chat uses memory-only turn order, not persisted Project or prior answer context", () => {
  const base = { mode: "temporary" as const, projectId: 15, chatId: 29,
    messages: [{ role: "assistant", metadata: {} }], temporaryContext: snapshot("temporary") };
  assert.equal(resolveScopedWorkbenchSymbol(base), "MSFT");
  assert.equal(resolveScopedWorkbenchSymbol({ ...base, messages: [
    ...base.messages, { role: "user", metadata: {} },
  ] }), null, "an unanswered Temporary user question cannot borrow the preceding temporary ticker");
  assert.equal(resolveScopedWorkbenchSymbol({ ...base, messages: [
    ...base.messages, { role: "user", metadata: {} }, { role: "assistant", metadata: {} },
  ] }), "MSFT", "a new Temporary assistant answer may use its current in-memory scoped context");
  assert.equal(resolveScopedWorkbenchSymbol({ ...base, temporaryContext: snapshot("project") }), null,
    "Temporary navigation never silently accepts a persisted Project snapshot");
});
