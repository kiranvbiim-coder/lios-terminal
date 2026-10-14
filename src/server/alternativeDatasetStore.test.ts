import assert from "node:assert/strict";
import test from "node:test";
import { alternativeSnapshotInputSchema } from "@shared/pointInTimeAlternativeData";
import { calculateEstimateSurprises, compareAlternativePayloads } from "./alternativeDatasetStore";
import { flattenSnapshotForColumnar } from "./columnarArtifactStore";

const observations = [
  { symbol: "ACME", metric: "eps" as const, fiscalPeriod: "FY2025", periodEnd: "2025-12-31", contributor: "A", value: 10, low: null, high: null, currency: "USD", unit: "per_share", publishedAt: "2026-01-10T00:00:00.000Z", availableAt: "2026-01-10T00:00:00.000Z", sourceUrl: null },
  { symbol: "ACME", metric: "eps" as const, fiscalPeriod: "FY2025", periodEnd: "2025-12-31", contributor: "B", value: 12, low: null, high: null, currency: "USD", unit: "per_share", publishedAt: "2026-01-10T00:00:00.000Z", availableAt: "2026-01-10T00:00:00.000Z", sourceUrl: null },
  { symbol: "ACME", metric: "eps" as const, fiscalPeriod: "FY2025", periodEnd: "2025-12-31", contributor: "A", value: 14, low: null, high: null, currency: "USD", unit: "per_share", publishedAt: "2026-02-01T00:00:00.000Z", availableAt: "2026-02-01T00:00:00.000Z", sourceUrl: null },
];

test("constituent estimates calculate surprise only from the latest pre-report vintage", () => {
  const result = calculateEstimateSurprises({ symbol: "ACME", observations, actuals: [{ metric: "eps", fiscalPeriod: "FY2025", periodEnd: "2025-12-31", value: 15, reportedAt: "2026-02-15T00:00:00.000Z", availableAt: "2026-02-15T00:00:00.000Z" }] });
  assert.equal(result.length, 1); assert.equal(result[0].consensus, 14); assert.equal(result[0].difference, 1); assert.equal(result[0].surprisePct, 1 / 14); assert.equal(result[0].contributorCount, 1);
});

test("alternative snapshot contracts reject private data without valid clocks and values", () => {
  const parsed = alternativeSnapshotInputSchema.safeParse({ dataClass: "private_series", entityKey: "sales", source: "upload", provider: "user_supplied", frequency: "monthly", timezone: "UTC", currency: null, effectiveAt: null, publishedAt: null, retrievedAt: "bad", availableAt: "bad", organizationId: 1, lineage: {}, payload: { seriesId: "sales", name: "Sales", unit: "USD", frequency: "monthly", observations: [{ observationAt: "2026-01-01T00:00:00.000Z", value: Number.NaN, availableAt: "2026-02-01T00:00:00.000Z" }] } });
  assert.equal(parsed.success, false);
});

test("cross-asset payload hashes are deterministic and detect revisions", () => {
  assert.equal(compareAlternativePayloads({ a: 1, b: 2 }, { b: 2, a: 1 }).status, "unchanged");
  assert.equal(compareAlternativePayloads({ a: 1 }, { a: 2 }).status, "revised");
});

test("options chains flatten into analytical rows without dropping greeks", () => {
  const flat = flattenSnapshotForColumnar({ id: "snapshot", dataClass: "options_chain", entityKey: "ACME", payload: { underlying: "ACME", contracts: [{ contractSymbol: "ACME260101C00100000", underlying: "ACME", type: "call", strike: 100, expiry: "2026-01-01", quoteAt: "2025-12-01T00:00:00.000Z", bid: 4, ask: 5, last: 4.5, volume: 10, openInterest: 100, underlyingPrice: 102, impliedVolatility: 0.25, delta: 0.55, gamma: 0.02, theta: -0.01, vega: 0.1, rho: 0.03, multiplier: 100, currency: "USD" }] } });
  assert.equal(flat.records.length, 1); assert.equal(flat.records[0].delta, 0.55); assert.ok(flat.numericColumns.includes("implied_volatility"));
});
