import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderStackOrder, sortIdsByStackOrder, findPin, resolveFamilyProviderOrder } from "./dataStackService";
import type { DataStackPin } from "@shared/dataStackPins";

test("normalizeProviderStackOrder keeps connected ids and appends missing connections", () => {
  assert.deepEqual(
    normalizeProviderStackOrder(["polygon", "finnhub", "missing"], ["finnhub", "lse", "polygon"]),
    ["polygon", "finnhub", "lse"],
  );
});

test("sortIdsByStackOrder respects user rank", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(sortIdsByStackOrder(items, ["c", "a"]), [{ id: "c" }, { id: "a" }, { id: "b" }]);
});

function pin(overrides: Partial<DataStackPin>): DataStackPin {
  return {
    id: overrides.id ?? "pin-1",
    scope: "global",
    family: null,
    symbol: null,
    metric: null,
    providerId: "tiingo",
    reason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: 1,
    ...overrides,
  };
}

test("findPin picks the most specific matching pin: metric > symbol > family > global", () => {
  const pins: DataStackPin[] = [
    pin({ id: "g", scope: "global", providerId: "polygon" }),
    pin({ id: "f", scope: "family", family: "statements", providerId: "finnhub" }),
    pin({ id: "s", scope: "symbol", family: "statements", symbol: "AAPL", providerId: "sec_edgar" }),
    pin({ id: "m", scope: "metric", family: "statements", symbol: "AAPL", metric: "revenue", providerId: "lse" }),
  ];
  assert.equal(findPin(pins, "statements", "AAPL", "revenue")?.id, "m");
  assert.equal(findPin(pins, "statements", "AAPL", "netIncome")?.id, "s");
  assert.equal(findPin(pins, "statements", "MSFT", "revenue")?.id, "f");
  assert.equal(findPin(pins, "quote", "MSFT")?.id, "g");
});

test("findPin ignores pins for a different symbol/family and returns null with no match", () => {
  const pins: DataStackPin[] = [pin({ scope: "symbol", family: "statements", symbol: "AAPL", providerId: "sec_edgar" })];
  assert.equal(findPin(pins, "statements", "MSFT"), null);
  assert.equal(findPin(pins, "quote", "AAPL"), null);
});

test("findPin breaks a same-specificity tie by most-recently-created", () => {
  const pins: DataStackPin[] = [
    pin({ id: "old", scope: "family", family: "statements", providerId: "finnhub", createdAt: "2026-01-01T00:00:00.000Z" }),
    pin({ id: "new", scope: "family", family: "statements", providerId: "lse", createdAt: "2026-02-01T00:00:00.000Z" }),
  ];
  assert.equal(findPin(pins, "statements")?.id, "new");
});

test("resolveFamilyProviderOrder with no pins/stack order returns the default order untouched", () => {
  assert.deepEqual(resolveFamilyProviderOrder("statements", ["lse", "sec_edgar", "finnhub"]), ["lse", "sec_edgar", "finnhub"]);
});

test("resolveFamilyProviderOrder applies global stack order when no pin exists", () => {
  const order = resolveFamilyProviderOrder("statements", ["lse", "sec_edgar", "finnhub"], { globalStackOrder: ["finnhub", "lse"] });
  assert.deepEqual(order, ["finnhub", "lse", "sec_edgar"]);
});

test("resolveFamilyProviderOrder: a matching pin forces its provider first, ahead of stack order", () => {
  const pins: DataStackPin[] = [pin({ scope: "symbol", family: "statements", symbol: "AAPL", providerId: "finnhub" })];
  const order = resolveFamilyProviderOrder("statements", ["lse", "sec_edgar", "finnhub"], {
    globalStackOrder: ["lse", "sec_edgar"], // finnhub would otherwise rank last
    pins,
    symbol: "AAPL",
  });
  assert.deepEqual(order, ["finnhub", "lse", "sec_edgar"]);
});

test("resolveFamilyProviderOrder: a pin for a provider the family doesn't have is ignored, never invented", () => {
  const pins: DataStackPin[] = [pin({ scope: "family", family: "statements", providerId: "does_not_exist" })];
  const order = resolveFamilyProviderOrder("statements", ["lse", "sec_edgar"], { pins });
  assert.deepEqual(order, ["lse", "sec_edgar"]);
});

test("resolveFamilyProviderOrder: a pin scoped to a different symbol does not apply", () => {
  const pins: DataStackPin[] = [pin({ scope: "symbol", family: "statements", symbol: "MSFT", providerId: "finnhub" })];
  const order = resolveFamilyProviderOrder("statements", ["lse", "sec_edgar", "finnhub"], { pins, symbol: "AAPL" });
  assert.deepEqual(order, ["lse", "sec_edgar", "finnhub"]);
});
