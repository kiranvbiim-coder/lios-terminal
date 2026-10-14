import assert from "node:assert/strict";
import test from "node:test";
import { buildScalarSeriesPayload, buildYieldCurvePayload, compareEconomicDatasetPayloads, compareYieldCurvePayloads, inferObservationFrequency } from "./economicDatasetStore";

test("frequency inference distinguishes daily, monthly, quarterly, and annual series", () => {
  assert.equal(inferObservationFrequency([{ date: "2024-01-01" }, { date: "2024-01-02" }]), "daily");
  assert.equal(inferObservationFrequency([{ date: "2024-01-01" }, { date: "2024-02-01" }]), "monthly");
  assert.equal(inferObservationFrequency([{ date: "2024-01-01" }, { date: "2024-04-01" }]), "quarterly");
  assert.equal(inferObservationFrequency([{ date: "2023-01-01" }, { date: "2024-01-01" }]), "annual");
});

test("FRED scalar normalization preserves vintages and source availability separately from retrieval", () => {
  const result = buildScalarSeriesPayload({ seriesId: "unrate", name: "Unemployment", unit: "%", category: "Labor", retrievedAt: "2026-08-24T10:00:00.000Z", observations: [
    { date: "2026-06-01", value: 4.1, realtimeStart: "2026-07-03", realtimeEnd: "2026-08-01" },
    { date: "2026-07-01", value: 4.2, realtimeStart: "2026-08-07", realtimeEnd: "9999-12-31" },
  ] });
  assert.equal(result.payload.seriesId, "UNRATE");
  assert.equal(result.payload.frequency, "monthly");
  assert.equal(result.payload.observations[1].availableAt, "2026-08-07T00:00:00.000Z");
  assert.equal(result.quality.vintageCoverage, 1);
  assert.equal(result.quality.score, 1);
});

test("Treasury curve normalization retains tenor dates and reports incomplete curves", () => {
  const labels = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
  const result = buildYieldCurvePayload(labels.map((label, index) => ({
    label, seriesId: `DGS${label}`, yield: index === 10 ? null : 4 + index / 10,
    asOf: index === 0 ? "2026-08-20" : "2026-08-21", realtimeStart: "2026-08-24",
  })));
  assert.equal(result.payload.points.length, 11);
  assert.equal(result.payload.points[8].maturityYears, 10);
  assert.equal(result.quality.validObservationCount, 10);
  assert.ok(result.quality.warnings.some((warning) => warning.includes("1 Treasury tenors")));
  assert.ok(result.quality.warnings.some((warning) => warning.includes("different latest observation dates")));
});

test("economic revisions separate appended dates from revised vintage values", () => {
  const make = (observations: Array<{ date: string; value: number; realtimeStart: string }>) => buildScalarSeriesPayload({
    seriesId: "GDP", name: "GDP", unit: "Billions", category: "Growth", retrievedAt: "2026-08-24T12:00:00.000Z",
    observations: observations.map((row) => ({ ...row, realtimeEnd: "9999-12-31" })),
  }).payload;
  const report = compareEconomicDatasetPayloads(
    make([{ date: "2026-01-01", value: 100, realtimeStart: "2026-04-01" }]),
    make([{ date: "2026-01-01", value: 101, realtimeStart: "2026-05-01" }, { date: "2026-04-01", value: 105, realtimeStart: "2026-07-01" }]),
  );
  assert.equal(report.status, "revised");
  assert.equal(report.changedObservations, 1);
  assert.deepEqual(report.addedDates, ["2026-04-01"]);
  assert.equal(report.revisions[0].afterVintage.realtimeStart, "2026-05-01");
});

test("yield curve revisions retain tenor-specific dates and basis-point changes", () => {
  const tenors = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
  const curve = (tenYear: number, date: string) => buildYieldCurvePayload(tenors.map((label, index) => ({
    label, seriesId: `DGS${label}`, yield: label === "10Y" ? tenYear : 4 + index / 100,
    asOf: label === "10Y" ? date : "2026-08-21", realtimeStart: label === "10Y" ? date : "2026-08-21",
  }))).payload;
  const report = compareYieldCurvePayloads(curve(4.1, "2026-08-21"), curve(4.2, "2026-08-24"));
  assert.equal(report.changedTenors, 1);
  assert.ok(Math.abs((report.revisions[0].absoluteChange ?? 0) - 0.1) < 1e-12);
  assert.equal(report.revisions[0].afterObservationDate, "2026-08-24");
});
