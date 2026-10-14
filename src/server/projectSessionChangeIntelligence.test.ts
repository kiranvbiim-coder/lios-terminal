import assert from "node:assert/strict";
import test from "node:test";
import { compareProjectSessionStateValues } from "./projectSessionStore";

function analyticalState(symbol = "AAPL") {
  return {
    version: 2, capturedAt: "2026-09-22T04:00:00.000Z",
    activeTab: { id: "tab-1", title: "Analysis", kind: "entity", entity: symbol, groupId: null, linkGroupId: "A", linkScopes: ["instrument", "time"], pinned: false,
      workspace: { primary: { view: "valuation", symbol }, secondary: null, tertiary: null, quaternary: null, focusedPane: "primary" } },
    tabs: [{ id: "tab-1", title: "Analysis", kind: "entity", entity: symbol, groupId: null, linkGroupId: "A", linkScopes: ["instrument", "time"], pinned: false,
      workspace: { primary: { view: "valuation", symbol }, secondary: null, tertiary: null, quaternary: null, focusedPane: "primary" } }],
    activeTabIndex: 0, paneStates: [], viewStates: [], timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  };
}
function session(input: { id: string; parentSessionId?: string | null; sourcePolicyRef?: string | null; strategyRef?: string | null; assumptionRefs?: string[]; symbol?: string }) {
  const now = new Date("2026-09-22T04:00:00.000Z"); const symbol = input.symbol ?? "AAPL";
  return {
    id: input.id, projectId: 1, chatId: 2, parentSessionId: input.parentSessionId ?? null, ownerUserId: 3, organizationId: null, name: input.id, status: "active",
    workspaceState: {
      version: 1, workspaceEngine: "dockview", analyticalState: analyticalState(symbol), dockviewLayout: { grid: { root: "primary" } },
      linkedContext: { contexts: { "tab-1": { instrument: symbol, time: { enabled: false, asOfDate: null, mode: "latest" }, scenarioId: null, portfolioId: null, benchmarkId: null } }, channels: {} },
      focusedObject: { kind: "panel", id: "primary", label: "Valuation", view: "valuation", symbol, paneId: "primary" }, savedViewName: null,
      provenance: { layoutStateRef: "layout:v1", sourcePolicyRef: input.sourcePolicyRef ?? null, strategyRef: input.strategyRef ?? null, backtestRef: null, assumptionRefs: input.assumptionRefs ?? [], artifactVersionRefs: [] },
    },
    createdAt: now, updatedAt: now, archivedAt: null,
  } as any;
}
test("P3 Session comparison identifies source strategy assumption and ancestry changes", () => {
  const left = session({ id: "session:left", sourcePolicyRef: "policy:filings", strategyRef: "strategy:v1", assumptionRefs: ["wacc:8"] });
  const right = session({ id: "session:right", parentSessionId: "session:left", sourcePolicyRef: "policy:consensus", strategyRef: "strategy:v2", assumptionRefs: ["wacc:9"] });
  const changed = new Set(compareProjectSessionStateValues({ left, right }).filter((x) => x.changed).map((x) => x.category));
  for (const category of ["ancestry", "source_policy", "strategy", "assumptions"]) assert.equal(changed.has(category as any), true);
});
test("P3 Session comparison identifies linked analytical context changes", () => {
  const diffs = compareProjectSessionStateValues({ left: session({ id: "left", symbol: "AAPL" }), right: session({ id: "right", symbol: "MSFT" }) });
  assert.equal(diffs.find((x) => x.category === "linked_context")?.changed, true);
  assert.equal(diffs.find((x) => x.category === "analytical_state")?.changed, true);
});
