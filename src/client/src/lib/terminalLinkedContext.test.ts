import test from "node:test";
import assert from "node:assert/strict";
import { createLiOSContext } from "@shared/context";
import {
  applyLinkedContextToLiOSContext,
  broadcastLinkedContext,
  broadcastTerminalLinkedContext,
  createTerminalLinkedContextState,
  hydrateLinkedTabContext,
  hydrateTerminalLinkedContext,
  linkedTabsForScope,
  normalizeLinkedContext,
  propagateLinkedContext,
} from "./terminalLinkedContext";
import type { TerminalTab, TerminalTabsState } from "./terminalTabs";

function tab(id: string, linkGroupId: TerminalTab["linkGroupId"], linkScopes: NonNullable<TerminalTab["linkScopes"]>): TerminalTab {
  return {
    id,
    title: id,
    kind: "workspace",
    workspace: { primary: { view: "market", symbol: "AAPL" }, secondary: null, focusedPane: "primary" },
    entity: null,
    groupId: null,
    linkGroupId,
    linkScopes,
    pinned: false,
    preview: false,
    dirty: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const state: TerminalTabsState = {
  tabs: [
    tab("source", "A", ["instrument", "time"]),
    tab("instrument-only", "A", ["instrument"]),
    tab("time-only", "A", ["time"]),
    tab("other-group", "B", ["instrument", "time"]),
  ],
  activeTabId: "source",
  closedTabs: [],
};

test("linked context propagates only shared scopes in the same group", () => {
  const next = propagateLinkedContext(state, {}, "source", {
    instrument: " nvda ",
    time: { enabled: true, asOfDate: "2026-06-30", mode: "as-known-on" },
  });

  assert.equal(next.source.instrument, "NVDA");
  assert.equal(next["instrument-only"].instrument, "NVDA");
  assert.equal(next["instrument-only"].time, undefined);
  assert.equal(next["time-only"].instrument, undefined);
  assert.equal(next["time-only"].time?.asOfDate, "2026-06-30");
  assert.equal(next["other-group"], undefined);
});

test("unlinked tabs keep an update local", () => {
  const localState: TerminalTabsState = { ...state, tabs: [tab("source", null, ["instrument", "time"])] };
  const next = propagateLinkedContext(localState, {}, "source", { instrument: "msft" });
  assert.deepEqual(next.source, { instrument: "MSFT" });
});

test("linkedTabsForScope reports only opted-in recipients", () => {
  assert.deepEqual(linkedTabsForScope(state, "source", "time").map((item) => item.id), ["source", "time-only"]);
  assert.deepEqual(linkedTabsForScope(state, "source", "portfolio"), []);
});

test("linked channels retain only source-enabled context dimensions", () => {
  const result = broadcastLinkedContext(state, {}, {}, "source", {
    instrument: " nvda ",
    time: { enabled: true, asOfDate: "2026-06-30", mode: "as-known-on" },
    scenarioId: "bull",
    portfolioId: "core-book",
    benchmarkId: "SPX",
  });

  assert.deepEqual(result.channels.A, {
    instrument: "NVDA",
    time: { enabled: true, asOfDate: "2026-06-30", mode: "as-known-on" },
  });
  assert.equal(result.contexts["instrument-only"].instrument, "NVDA");
  assert.equal(result.contexts["time-only"].time?.asOfDate, "2026-06-30");
  assert.equal(result.contexts.source.scenarioId, "bull", "source-local context remains available even when the dimension is not linked");
});

test("a tab joining a channel hydrates immediately from retained context", () => {
  const broadcast = broadcastLinkedContext(state, {}, {}, "source", {
    instrument: "NVDA",
    time: { enabled: true, asOfDate: "2026-06-30", mode: "as-known-on" },
  });
  const joinedState: TerminalTabsState = {
    ...state,
    tabs: [...state.tabs, tab("late-joiner", "A", ["time"])],
  };
  const hydrated = hydrateLinkedTabContext(joinedState, broadcast.contexts, broadcast.channels, "late-joiner");

  assert.equal(hydrated["late-joiner"].instrument, undefined);
  assert.equal(hydrated["late-joiner"].time?.asOfDate, "2026-06-30");
});

test("channel retention updates one dimension without erasing the others", () => {
  const first = broadcastLinkedContext(state, {}, {}, "source", {
    instrument: "NVDA",
    time: { enabled: true, asOfDate: "2026-06-30", mode: "as-known-on" },
  });
  const second = broadcastLinkedContext(state, first.contexts, first.channels, "source", { instrument: "MSFT" });

  assert.equal(second.channels.A?.instrument, "MSFT");
  assert.equal(second.channels.A?.time?.asOfDate, "2026-06-30");
});

test("normalization trims ids and refuses malformed point-in-time intent", () => {
  const normalized = normalizeLinkedContext({
    instrument: " msft ",
    scenarioId: " bear-case ",
    portfolioId: " core-book ",
    benchmarkId: " spx-total-return ",
    time: { enabled: true, asOfDate: null, mode: "as-known-on" },
  });

  assert.equal(normalized.instrument, "MSFT");
  assert.equal(normalized.scenarioId, "bear-case");
  assert.equal(normalized.portfolioId, "core-book");
  assert.equal(normalized.benchmarkId, "spx-total-return");
  assert.deepEqual(normalized.time, { enabled: false, asOfDate: null, mode: "latest" });
});

test("linked context reducer retains channels and hydrates late joiners", () => {
  const initial = createTerminalLinkedContextState();
  const broadcast = broadcastTerminalLinkedContext(initial, state, "source", {
    time: { enabled: true, asOfDate: "2026-09-01", mode: "as-known-on" },
  });
  assert.equal(broadcast.channels.A?.time?.asOfDate, "2026-09-01");

  const joinedState: TerminalTabsState = {
    ...state,
    tabs: [...state.tabs, tab("late", "A", ["time"])],
  };
  const hydrated = hydrateTerminalLinkedContext(broadcast, joinedState, "late");
  assert.equal(hydrated.contexts.late.time?.asOfDate, "2026-09-01");
});

test("linked payload bridges into universal LiOS context without replacing entity or view", () => {
  const base = createLiOSContext({
    entity: { entityId: null, symbol: "NVDA", name: null, exchange: null, region: null, assetClass: null },
    workspaceId: "finance",
    viewId: "valuation",
  });
  const next = applyLinkedContextToLiOSContext(base, {
    time: { enabled: true, asOfDate: "2026-09-01", mode: "as-known-on" },
    scenarioId: "bear-case",
    portfolioId: "growth-book",
    benchmarkId: "spx-tr",
  });

  assert.equal(next.entity?.symbol, "NVDA");
  assert.equal(next.viewId, "valuation");
  assert.equal(next.portfolioId, "growth-book");
  assert.equal(next.scenarioId, "bear-case");
  assert.equal(next.benchmarkId, "spx-tr");
  assert.deepEqual(next.time, { mode: "as-known-on", asOfDate: "2026-09-01" });
  assert.equal(next.revision, 1);
});
