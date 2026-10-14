import assert from "node:assert/strict";
import test from "node:test";
import { parseDataStackPins, dataStackPinsSchema, createDataStackPinSchema, type DataStackPin } from "./dataStackPins";

function validPin(overrides: Partial<DataStackPin> = {}): DataStackPin {
  return {
    id: "p1",
    scope: "family",
    family: "statements",
    symbol: null,
    metric: null,
    providerId: "sec_edgar",
    reason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: 1,
    ...overrides,
  };
}

test("parseDataStackPins returns [] for the pre-migration '{}' object shape rather than throwing", () => {
  assert.deepEqual(parseDataStackPins({}), []);
});

test("parseDataStackPins returns [] for null/undefined/non-array garbage rather than throwing", () => {
  assert.deepEqual(parseDataStackPins(null), []);
  assert.deepEqual(parseDataStackPins(undefined), []);
  assert.deepEqual(parseDataStackPins("not an array"), []);
  assert.deepEqual(parseDataStackPins(42), []);
});

test("parseDataStackPins keeps well-formed pins and silently drops malformed entries from a mixed array", () => {
  const good = validPin();
  const badScopeConsistency = { ...validPin({ id: "p2" }), scope: "metric", metric: null }; // metric scope requires a metric
  const badMissingField = { id: "p3", scope: "family" }; // missing providerId etc.
  const parsed = parseDataStackPins([good, badScopeConsistency, badMissingField, "not even an object"]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "p1");
});

test("dataStackPinsSchema rejects a global pin that carries a family (scope-consistency)", () => {
  const result = dataStackPinsSchema.safeParse([validPin({ scope: "global", family: "statements" })]);
  assert.equal(result.success, false);
});

test("dataStackPinsSchema rejects a symbol pin missing its symbol", () => {
  const result = dataStackPinsSchema.safeParse([validPin({ scope: "symbol", symbol: null })]);
  assert.equal(result.success, false);
});

test("createDataStackPinSchema accepts a valid metric-scoped request and defaults optional fields to null", () => {
  const parsed = createDataStackPinSchema.safeParse({ scope: "metric", family: "statements", symbol: "AAPL", metric: "revenue", providerId: "sec_edgar" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.reason, null);
});

test("createDataStackPinSchema rejects a metric-scoped request missing the metric", () => {
  const parsed = createDataStackPinSchema.safeParse({ scope: "metric", family: "statements", symbol: "AAPL", providerId: "sec_edgar" });
  assert.equal(parsed.success, false);
});
