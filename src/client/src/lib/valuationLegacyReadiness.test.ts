import test from "node:test";
import assert from "node:assert/strict";

import { assessLegacyValuationReadiness } from "./valuationLegacyReadiness";

test("legacy valuation is blocked instead of substituting fictional market inputs", () => {
  const readiness = assessLegacyValuationReadiness({
    spot: null,
    marketCap: null,
    revenue: null,
    sharesOutstanding: null,
    balanceSheetAvailable: false,
  });

  assert.equal(readiness.canRun, false);
  assert.equal(readiness.sharesSource, "missing");
  assert.ok(readiness.blockers.some((item) => item.includes("market price")));
  assert.ok(readiness.blockers.some((item) => item.includes("market capitalization")));
  assert.ok(readiness.blockers.some((item) => item.includes("revenue")));
  assert.ok(readiness.blockers.some((item) => item.includes("balance sheet")));
  assert.ok(readiness.blockers.some((item) => item.includes("Shares outstanding")));
});

test("reported shares pass the source gate when all critical observations are available", () => {
  const readiness = assessLegacyValuationReadiness({
    spot: 200,
    marketCap: 3_000_000_000_000,
    revenue: 400_000_000_000,
    sharesOutstanding: 15_000_000_000,
    balanceSheetAvailable: true,
  });

  assert.equal(readiness.canRun, true);
  assert.equal(readiness.sharesSource, "reported");
  assert.equal(readiness.resolvedShares, 15_000_000_000);
  assert.deepEqual(readiness.blockers, []);
  assert.deepEqual(readiness.warnings, []);
});

test("shares may be transparently derived from observed market cap and spot", () => {
  const readiness = assessLegacyValuationReadiness({
    spot: 125,
    marketCap: 250_000_000_000,
    revenue: 50_000_000_000,
    sharesOutstanding: null,
    balanceSheetAvailable: true,
  });

  assert.equal(readiness.canRun, true);
  assert.equal(readiness.sharesSource, "derived-market-cap-over-spot");
  assert.equal(readiness.resolvedShares, 2_000_000_000);
  assert.equal(readiness.warnings.length, 1);
});
