import assert from "node:assert/strict";
import test from "node:test";
import { clearLiOSContext, createLiOSContext, patchLiOSContext } from "@shared/context";

test("universal context normalizes entity and optional identifiers", () => {
  const context = createLiOSContext({
    entity: {
      entityId: "  entity-123  ",
      symbol: " nvda ",
      name: " NVIDIA Corporation ",
      exchange: " NASDAQ ",
      region: " US ",
      assetClass: " equity ",
    },
    portfolioId: " growth-fund ",
    region: " North America ",
    scenarioId: " bear-case ",
    benchmarkId: " spx ",
    workspaceId: " equity-research ",
    viewId: " valuation ",
  });

  assert.equal(context.entity?.symbol, "NVDA");
  assert.equal(context.entity?.entityId, "entity-123");
  assert.equal(context.entity?.name, "NVIDIA Corporation");
  assert.equal(context.portfolioId, "growth-fund");
  assert.equal(context.region, "North America");
  assert.equal(context.revision, 0);
});

test("context revision changes only for meaningful semantic changes", () => {
  const initial = createLiOSContext({
    entity: { entityId: null, symbol: "AAPL", name: null, exchange: null, region: null, assetClass: null },
    viewId: "valuation",
  });
  const equivalent = patchLiOSContext(initial, {
    entity: { entityId: null, symbol: " aapl ", name: null, exchange: null, region: null, assetClass: null },
    viewId: " valuation ",
  });
  assert.equal(equivalent.revision, 0);

  const changed = patchLiOSContext(equivalent, {
    entity: { entityId: null, symbol: "MSFT", name: null, exchange: null, region: null, assetClass: null },
  });
  assert.equal(changed.revision, 1);
  assert.equal(changed.entity?.symbol, "MSFT");

  const timed = patchLiOSContext(changed, { time: { mode: "as-known-on", asOfDate: "2026-08-31" } });
  assert.equal(timed.revision, 2);
  assert.equal(timed.time.asOfDate, "2026-08-31");
});

test("context time semantics reject contradictory latest/as-of states", () => {
  assert.throws(
    () => createLiOSContext({ time: { mode: "as-known-on", asOfDate: null } }),
    /as-known-on context requires an asOfDate/,
  );
  assert.throws(
    () => createLiOSContext({ time: { mode: "latest", asOfDate: "2026-08-31" } }),
    /latest context cannot carry an asOfDate/,
  );
});

test("context parsing is copy-safe and clear is semantic", () => {
  const initial = createLiOSContext({
    entity: { entityId: null, symbol: "AAPL", name: "Apple", exchange: null, region: null, assetClass: "equity" },
    scenarioId: "upside",
  });
  const clone = patchLiOSContext(initial, {});
  assert.notEqual(clone, initial);
  assert.notEqual(clone.entity, initial.entity);
  if (clone.entity) clone.entity.name = "mutated copy";
  assert.equal(initial.entity?.name, "Apple");

  const cleared = clearLiOSContext(initial);
  assert.equal(cleared.entity, null);
  assert.equal(cleared.scenarioId, null);
  assert.equal(cleared.time.mode, "latest");
  assert.equal(cleared.revision, 1);
});
