import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEventFilterRows, rowsFromEventFilters, type P9EventFilterRow } from "./p9EventFilterEditor";

test("editable event conditions round-trip string, number and boolean values without JSON", () => {
  const source = { symbol: "MSFT", price: 125.75, active: false };
  const rows = rowsFromEventFilters(source);
  assert.deepEqual(rows.map(row => row.type), ["string", "number", "boolean"]);
  const parsed = parseEventFilterRows(rows);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data, source);
});

test("empty conditions match all permitted events, without executing anything", () => {
  const parsed = parseEventFilterRows([]);
  assert.deepEqual(parsed, { success: true, data: {} });
});

test("condition field names are exact and duplicates are rejected", () => {
  const base: P9EventFilterRow = { id: 1, key: "provider", type: "string", value: "SEC" };
  assert.equal(parseEventFilterRows([base, { ...base, id: 2 }]).success, false);
  assert.equal(parseEventFilterRows([{ ...base, key: " " }]).success, false);
  const special = parseEventFilterRows([{ ...base, key: "__proto__" }]);
  assert.equal(special.success, false);
});

test("invalid numbers and oversized strings are refused before saving", () => {
  const row: P9EventFilterRow = { id: 1, key: "threshold", type: "number", value: "Infinity" };
  assert.equal(parseEventFilterRows([row]).success, false);
  assert.equal(parseEventFilterRows([{ ...row, value: "   " }]).success, false);
  assert.equal(parseEventFilterRows([{ ...row, type: "string", value: "x".repeat(1001) }]).success, false);
});

test("the existing 50-filter server limit applies to structured edits", () => {
  const rows = Array.from({ length: 51 }, (_, id): P9EventFilterRow => ({
    id, key: "field_" + id, type: "boolean", value: "true",
  }));
  assert.equal(parseEventFilterRows(rows).success, false);
  assert.equal(parseEventFilterRows(rows.slice(0, 50)).success, true);
});


test("Project automation editor exposes typed form instead of raw JSON", () => {
  const source = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="p9-event-conditions"/);
  assert.match(source, /Add condition/);
  assert.match(source, /Remove condition/);
  assert.ok(!source.includes("Matching event filters (JSON object)"));
  assert.ok(!source.includes("setEventFiltersDraft"));
  assert.match(source, /<ReadableValueTable title="Latest source review"/);
  assert.ok(!source.includes("JSON.stringify(last.output.review"));
});
