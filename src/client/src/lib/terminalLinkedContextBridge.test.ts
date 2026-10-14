import test from "node:test";
import assert from "node:assert/strict";
import { createLiOSContext } from "@shared/context";
import { linkedContextFromLiOSContext, mergeLinkedLiOSContext } from "./terminalLinkedContextBridge";

test("universal context converts to the five linkable terminal dimensions", () => {
  const context = createLiOSContext({
    entity: { entityId: null, symbol: "nvda", name: null, exchange: null, region: null, assetClass: null },
    time: { mode: "as-known-on", asOfDate: "2026-09-01" },
    scenarioId: "bear-case",
    portfolioId: "growth-book",
    benchmarkId: "spx-tr",
  });

  assert.deepEqual(linkedContextFromLiOSContext(context), {
    instrument: "NVDA",
    time: { enabled: true, asOfDate: "2026-09-01", mode: "as-known-on" },
    scenarioId: "bear-case",
    portfolioId: "growth-book",
    benchmarkId: "spx-tr",
  });
});

test("non-entity universal context does not invent instrument context", () => {
  const context = createLiOSContext({
    time: { mode: "latest", asOfDate: null },
    viewId: "macrodashboard",
  });
  const linked = linkedContextFromLiOSContext(context);
  assert.equal(linked.instrument, undefined);
  assert.deepEqual(linked.time, { enabled: false, asOfDate: null, mode: "latest" });
});

test("linked round trip updates linkable dimensions without changing entity or view", () => {
  const base = createLiOSContext({
    entity: { entityId: null, symbol: "AAPL", name: null, exchange: null, region: null, assetClass: null },
    viewId: "valuation",
  });
  const next = mergeLinkedLiOSContext(base, {
    scenarioId: "bull-case",
    portfolioId: "pm-book",
    benchmarkId: "nasdaq-100",
    time: { enabled: true, asOfDate: "2026-08-31", mode: "as-known-on" },
  });

  assert.equal(next.entity?.symbol, "AAPL");
  assert.equal(next.viewId, "valuation");
  assert.equal(next.scenarioId, "bull-case");
  assert.equal(next.portfolioId, "pm-book");
  assert.equal(next.benchmarkId, "nasdaq-100");
  assert.deepEqual(next.time, { mode: "as-known-on", asOfDate: "2026-08-31" });
});
