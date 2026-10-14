import assert from "node:assert/strict";
import test from "node:test";
import { listBuiltInSemanticMetrics } from "./semanticFinanceService";

test("P5 built-in semantic metric catalog is versioned, searchable by aliases upstream, and PIT-aware", () => {
  const metrics = listBuiltInSemanticMetrics();
  assert.ok(metrics.length > 20);
  const revenue = metrics.find((metric) => metric.metricId === "revenue");
  assert.ok(revenue);
  assert.equal(revenue?.version, 1);
  assert.equal(revenue?.status, "active");
  assert.ok(revenue?.sourcePolicy.preferredCapabilities.includes("statements"));
  assert.equal(revenue?.sourcePolicy.pointInTimeRequired, true);
  assert.equal(new Set(metrics.map((metric) => metric.metricId)).size, metrics.length);
});
