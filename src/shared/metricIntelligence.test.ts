import assert from "node:assert/strict";
import test from "node:test";
import { resolveMetricIntelligence, type MetricObservationInput } from "./metricIntelligence";
function observation(metricId: string, value: number, extra: Partial<MetricObservationInput> = {}): MetricObservationInput {
  // Synthetic fixture observations are intentionally confined to this test module.
  return { metricId, value, status: "filed", unit: "currency", period: "FY2025", currency: "USD", provider: "fixture-provider", ...extra };
}

test("derives net debt and enterprise value from compatible dependencies", () => {
  const observations: MetricObservationInput[] = [
    observation("marketCap", 1_000),
    observation("shortTermDebt", 50),
    observation("longTermDebt", 150),
    observation("leaseLiabilities", 20),
    observation("cash", 100),
    observation("shortTermInvestments", 10),
    observation("preferredStock", 0),
    observation("minorityInterest", 0),
    observation("unfundedPension", 0),
    observation("nonOperatingInvestments", 0),
  ];
  const netDebt = resolveMetricIntelligence("netDebt", observations, { period: "FY2025", currency: "USD" });
  assert.ok(netDebt);
  assert.equal(netDebt.value, 110);
  assert.equal(netDebt.status, "derived");
  assert.equal(netDebt.valueKind, "derived");
  assert.deepEqual(netDebt.missingDependencies, []);
  assert.ok(netDebt.trace.some(item => item.metricId === "grossDebt"));

  const enterpriseValue = resolveMetricIntelligence("enterpriseValueDerived", observations, { period: "FY2025", currency: "USD" });
  assert.ok(enterpriseValue);
  assert.equal(enterpriseValue.value, 1_110);
  assert.equal(enterpriseValue.formula?.includes("marketCap"), true);
  assert.ok(enterpriseValue.definitions.some(definition => definition.id === "grossDebt"));
});

test("derives FCF yield and keeps formula provenance", () => {
  const result = resolveMetricIntelligence("fcfYield", [
    observation("fcf", 100),
    observation("marketCap", 1_000),
  ], { period: "FY2025", currency: "USD" });
  assert.ok(result);
  assert.equal(result.value, 0.1);
  assert.equal(result.valueKind, "derived");
  assert.equal(result.trace.find(item => item.metricId === "fcf")?.kind, "direct/provider");
});

test("does not zero-fill a missing required dependency", () => {
  const result = resolveMetricIntelligence("fcfYield", [observation("marketCap", 1_000)], { period: "FY2025", currency: "USD" });
  assert.ok(result);
  assert.equal(result.value, null);
  assert.equal(result.status, "missing");
  assert.deepEqual(result.missingDependencies, ["fcf"]);
});

test("withholds optional-component derivations instead of silently assuming zero", () => {
  const result = resolveMetricIntelligence("netDebt", [
    observation("shortTermDebt", 50),
    observation("longTermDebt", 150),
    observation("cash", 100),
  ], { period: "FY2025", currency: "USD" });
  assert.ok(result);
  assert.equal(result.value, null);
  assert.ok(result.missingDependencies.includes("leaseLiabilities"));
  assert.ok(result.optionalMissingDependencies.includes("shortTermInvestments"));
  assert.ok(result.comparabilityNotes.some(note => note.includes("rather than zero-filled")));
});

test("rejects incompatible units and periods before calculation", () => {
  const wrongUnit = resolveMetricIntelligence("fcfYield", [
    observation("fcf", 50),
    observation("marketCap", 1_000, { unit: "price" }),
  ], { period: "FY2025", currency: "USD" });
  assert.ok(wrongUnit);
  assert.equal(wrongUnit.value, null);
  assert.ok(wrongUnit.rejectedObservations.some(item => item.metricId === "marketCap" && item.reason.includes("incompatible")));

  const wrongPeriod = resolveMetricIntelligence("fcfYield", [
    observation("fcf", 50, { period: "FY2024" }),
    observation("marketCap", 1_000, { period: "FY2025" }),
  ]);
  assert.ok(wrongPeriod);
  assert.equal(wrongPeriod.value, null);
  assert.ok(wrongPeriod.comparabilityNotes.some(note => note.includes("incompatible reporting periods")));
});

test("retains all provider candidates and reports conflicts without selecting one", () => {
  const result = resolveMetricIntelligence("marketCap", [
    observation("market cap", 1_000, { provider: "provider-a" }),
    observation("marketCap", 1_100, { provider: "provider-b" }),
  ], { period: "FY2025", currency: "USD" });
  assert.ok(result);
  assert.equal(result.value, null);
  assert.equal(result.status, "conflict");
  assert.equal(result.valueKind, "conflict");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.candidates.map(candidate => candidate.provider), ["provider-a", "provider-b"]);
});

test("rejects null and NaN rather than treating them as observations", () => {
  const result = resolveMetricIntelligence("marketCap", [
    { metricId: "marketCap", value: null, status: "filed", unit: "currency" },
    { metricId: "marketCap", value: Number.NaN, status: "filed", unit: "currency" },
  ]);
  assert.ok(result);
  assert.equal(result.value, null);
  assert.equal(result.status, "missing");
  assert.equal(result.rejectedObservations.length, 2);
});

test("preserves unknown raw provider fields without promoting them", () => {
  const raw = {
    provider: "fixture-provider",
    field: "mystery_adjusted_value",
    value: 42,
    unit: "currency",
    sourceReference: "fixture-row-7",
    unexplainedProviderField: { code: "X" },
  };
  const result = resolveMetricIntelligence("marketCap", [raw]);
  assert.ok(result);
  assert.equal(result.value, null);
  assert.equal(result.rejectedObservations[0]?.reason.includes("Unknown metric alias"), true);
  assert.deepEqual(result.rawObservations[0], raw);
  assert.equal(result.candidates.length, 0);
});

test("distinguishes model-derived direct candidates and exposes source references", () => {
  const result = resolveMetricIntelligence("ebitdaNtm", [{
    metricId: "ebitdaNtm",
    value: 250,
    status: "estimate",
    kind: "model-derived",
    unit: "currency",
    provider: "internal-model",
    sourceReference: "model-run-17",
  }]);
  assert.ok(result);
  assert.equal(result.valueKind, "model-derived");
  assert.equal(result.sourceReference, "model-run-17");
  assert.equal(result.provider, "internal-model");
});
