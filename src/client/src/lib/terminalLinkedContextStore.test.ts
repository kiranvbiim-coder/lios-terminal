import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastTabLinkedContext,
  broadcastTabTimeContext,
  getEffectiveTerminalTabLinkScopes,
  hydrateTabLinkedContext,
  normalizeStoredLinkedContextState,
  resolveTabLinkedContext,
  resolveTabTimeContext,
  TERMINAL_ANALYTICAL_LINK_SCOPES,
  withLegacyFullLinkScopes,
} from "./terminalLinkedContextStore";
import { createTerminalLinkedContextState } from "./terminalLinkedContext";
import { setTerminalTabLinkScopes, type TerminalTab, type TerminalTabsState } from "./terminalTabs";

function tab(id: string, group: TerminalTab["linkGroupId"], scopes: NonNullable<TerminalTab["linkScopes"]>): TerminalTab {
  return {
    id,
    title: id,
    kind: "workspace",
    workspace: { primary: { view: "market", symbol: "AAPL" }, secondary: null, focusedPane: "primary" },
    entity: null,
    groupId: null,
    linkGroupId: group,
    linkScopes: scopes,
    pinned: false,
    preview: false,
    dirty: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("legacy linked tabs upgrade the historical instrument-only default to full analytical context", () => {
  const linked = tab("a", "A", ["instrument"]);
  const unlinked = tab("b", null, ["instrument"]);
  const state: TerminalTabsState = {
    tabs: [linked, unlinked],
    activeTabId: "a",
    closedTabs: [],
  };
  const upgraded = withLegacyFullLinkScopes(state);
  assert.deepEqual(getEffectiveTerminalTabLinkScopes(linked), [...TERMINAL_ANALYTICAL_LINK_SCOPES]);
  assert.deepEqual(upgraded.tabs[0].linkScopes, [...TERMINAL_ANALYTICAL_LINK_SCOPES]);
  assert.deepEqual(getEffectiveTerminalTabLinkScopes(unlinked), ["instrument"]);
  assert.deepEqual(upgraded.tabs[1].linkScopes, ["instrument"]);
});

test("explicit link scopes are preserved exactly including instrument-only precision links", () => {
  let state: TerminalTabsState = {
    tabs: [tab("a", "A", ["instrument"]), tab("b", "A", ["time"])],
    activeTabId: "a",
    closedTabs: [],
  };
  state = setTerminalTabLinkScopes(state, "a", ["instrument"]);
  state = setTerminalTabLinkScopes(state, "b", ["time"]);
  const upgraded = withLegacyFullLinkScopes(state);
  assert.equal(state.tabs[0].linkScopesExplicit, true);
  assert.equal(state.tabs[1].linkScopesExplicit, true);
  assert.deepEqual(getEffectiveTerminalTabLinkScopes(state.tabs[0]), ["instrument"]);
  assert.deepEqual(getEffectiveTerminalTabLinkScopes(state.tabs[1]), ["time"]);
  assert.deepEqual(upgraded.tabs[0].linkScopes, ["instrument"]);
  assert.deepEqual(upgraded.tabs[1].linkScopes, ["time"]);
});

test("time changes propagate through legacy linked groups but not unlinked tabs", () => {
  const tabs: TerminalTabsState = {
    tabs: [
      tab("source", "A", ["instrument"]),
      tab("linked", "A", ["instrument"]),
      tab("independent", null, ["instrument"]),
    ],
    activeTabId: "source",
    closedTabs: [],
  };
  const next = broadcastTabTimeContext(createTerminalLinkedContextState(), tabs, "source", {
    enabled: true,
    asOfDate: "2026-09-01",
    mode: "as-known-on",
  });
  assert.equal(resolveTabTimeContext(next, "source").asOfDate, "2026-09-01");
  assert.equal(resolveTabTimeContext(next, "linked").asOfDate, "2026-09-01");
  assert.equal(resolveTabTimeContext(next, "independent").mode, "latest");
});

test("portfolio scenario and benchmark use the same legacy linked group fan-out", () => {
  const tabs: TerminalTabsState = {
    tabs: [tab("source", "B", ["instrument"]), tab("linked", "B", ["instrument"]), tab("other", "C", ["instrument"])],
    activeTabId: "source",
    closedTabs: [],
  };
  const next = broadcastTabLinkedContext(createTerminalLinkedContextState(), tabs, "source", {
    portfolioId: " Growth Fund ",
    scenarioId: " Bear Case ",
    benchmarkId: " SPX ",
  });
  assert.deepEqual(resolveTabLinkedContext(next, "linked"), {
    portfolioId: "Growth Fund",
    scenarioId: "Bear Case",
    benchmarkId: "SPX",
  });
  assert.deepEqual(resolveTabLinkedContext(next, "other"), {});
});

test("explicit scopes keep generic dimensions isolated", () => {
  let tabs: TerminalTabsState = {
    tabs: [
      tab("source", "D", ["scenario", "portfolio"]),
      tab("scenario", "D", ["scenario"]),
      tab("portfolio", "D", ["portfolio"]),
    ],
    activeTabId: "source",
    closedTabs: [],
  };
  tabs = setTerminalTabLinkScopes(tabs, "source", ["scenario", "portfolio"]);
  tabs = setTerminalTabLinkScopes(tabs, "scenario", ["scenario"]);
  tabs = setTerminalTabLinkScopes(tabs, "portfolio", ["portfolio"]);
  const next = broadcastTabLinkedContext(createTerminalLinkedContextState(), tabs, "source", {
    scenarioId: "Downside",
    portfolioId: "Core",
    benchmarkId: "SPX",
  });
  assert.equal(resolveTabLinkedContext(next, "scenario").scenarioId, "Downside");
  assert.equal(resolveTabLinkedContext(next, "scenario").portfolioId, undefined);
  assert.equal(resolveTabLinkedContext(next, "portfolio").portfolioId, "Core");
  assert.equal(resolveTabLinkedContext(next, "portfolio").scenarioId, undefined);
  assert.equal(resolveTabLinkedContext(next, "source").benchmarkId, "SPX", "source-local context is still retained");
});

test("late joiners hydrate only the scopes they explicitly accept", () => {
  let initialTabs: TerminalTabsState = {
    tabs: [tab("source", "A", ["instrument", "time", "portfolio"])],
    activeTabId: "source",
    closedTabs: [],
  };
  initialTabs = setTerminalTabLinkScopes(initialTabs, "source", ["instrument", "time", "portfolio"]);
  const broadcast = broadcastTabLinkedContext(createTerminalLinkedContextState(), initialTabs, "source", {
    time: { enabled: true, asOfDate: "2026-08-31", mode: "as-known-on" },
    portfolioId: "Growth Fund",
  });
  let joinedTabs: TerminalTabsState = {
    ...initialTabs,
    tabs: [...initialTabs.tabs, tab("joined", "A", ["time"])],
  };
  joinedTabs = setTerminalTabLinkScopes(joinedTabs, "joined", ["time"]);
  const hydrated = hydrateTabLinkedContext(broadcast, joinedTabs, "joined");
  assert.equal(resolveTabTimeContext(hydrated, "joined").asOfDate, "2026-08-31");
  assert.equal(resolveTabLinkedContext(hydrated, "joined").portfolioId, undefined);
});

test("stored linked context parsing is fail-closed and normalizes analytical dimensions", () => {
  const parsed = normalizeStoredLinkedContextState({
    contexts: {
      a: { time: { enabled: true, asOfDate: "2026-09-01", mode: "as-known-on" }, scenarioId: " bear " },
      malformed: "nope",
    },
    channels: {
      A: { portfolioId: " core " },
      Z: { scenarioId: "ignored" },
    },
  });
  assert.equal(parsed.contexts.a.time?.asOfDate, "2026-09-01");
  assert.equal(parsed.contexts.a.scenarioId, "bear");
  assert.equal(parsed.contexts.malformed.time, undefined);
  assert.equal(parsed.channels.A?.portfolioId, "core");
  assert.equal((parsed.channels as Record<string, unknown>).Z, undefined);
});
