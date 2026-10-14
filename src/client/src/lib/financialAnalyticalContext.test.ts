import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialAnalyticalContext, contextMetric } from "@shared/financialAnalyticalContext";

const observation = (metricId: string, value: number, period = "CURRENT") => ({ metricId, value, period, status: "filed" as const, source: "fixture", asOf: "2026-01-01", currency: "USD" });

test("analytical context exposes canonical metrics, trust, quality and readiness", () => {
  const context = buildFinancialAnalyticalContext({
    symbol: "aapl",
    observations: [observation("marketCap", 1000), observation("cash", 100), observation("shortTermDebt", 0), observation("longTermDebt", 100), observation("ebitda", 20)],
    sector: "Technology",
    metricIds: ["enterpriseValue", "evEbitda"],
  });
  assert.equal(context.symbol, "AAPL");
  assert.equal(contextMetric(context, "enterpriseValue")?.value, 1000);
  assert.equal(contextMetric(context, "evEbitda")?.value, 50);
  assert.equal(context.trust.conflictCount, 0);
  assert.equal(context.quality.issues.length, 0);
  assert.ok(context.valuationReadiness.length > 0);
});
