import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsensusSignals,
  buildRevisionSeries,
  calculateConsensusStatistics,
  compareConsensusBenchmarks,
  consensusSnapshotHash,
  revisionAcceleration,
  type ConsensusBenchmarkLike,
  type ConsensusSnapshotLike,
} from "./consensusService";

function snapshot(id: number, median: number, asOf: string, overrides: Partial<ConsensusSnapshotLike> = {}): ConsensusSnapshotLike {
  return { id, symbol: "ACME", metric: "eps", fiscalPeriod: "FY2027", estimateAsOf: new Date(asOf), mean: median, median, high: median + 0.2, low: median - 0.2, contributorCount: 10, upwardRevisionCount: 3, downwardRevisionCount: 1, unchangedRevisionCount: 6, ...overrides };
}

test("consensus statistics calculate known mean, median, range, and population deviation", () => {
  assert.deepEqual(calculateConsensusStatistics([8, 10, 12, 14]), {
    mean: 11,
    median: 11,
    high: 14,
    low: 8,
    contributorCount: 4,
    standardDeviation: 2.236068,
    dispersionPct: 54.545455,
  });
});

test("consensus statistics reject empty and non-finite observations", () => {
  assert.throws(() => calculateConsensusStatistics([]), /At least one/);
  assert.throws(() => calculateConsensusStatistics([1, Number.NaN]), /finite/);
});

test("revision series is chronological and calculates breadth, momentum, and acceleration", () => {
  const series = buildRevisionSeries([
    snapshot(3, 110, "2026-03-01", { upwardRevisionCount: 1, downwardRevisionCount: 3 }),
    snapshot(1, 100, "2026-01-01"),
    snapshot(2, 105, "2026-02-01"),
  ]);
  assert.deepEqual(series.map((point) => point.snapshotId), [1, 2, 3]);
  assert.equal(series[1].medianChangePct, 5);
  assert.equal(series[2].medianChangePct, 4.761905);
  assert.equal(series[2].breadth, -0.5);
  assert.equal(revisionAcceleration(series), -0.238095);
});

test("reported surprise uses the latest consensus available before the result", () => {
  const snapshots = [snapshot(1, 2, "2026-01-01"), snapshot(2, 2.2, "2026-02-01"), snapshot(3, 2.4, "2026-04-01")];
  const actual: ConsensusBenchmarkLike = { id: 8, symbol: "ACME", metric: "eps", fiscalPeriod: "FY2027", benchmarkKind: "reported_actual", value: 2.42, low: null, high: null, effectiveAt: new Date("2026-03-01"), evidenceIds: [7] };
  const [comparison] = compareConsensusBenchmarks(snapshots, [actual]);
  assert.equal(comparison.consensusSnapshotId, 2);
  assert.equal(comparison.difference, 0.22);
  assert.equal(comparison.differencePct, 10);
  assert.deepEqual(comparison.evidenceIds, [7]);
});

test("guidance midpoint and Limuria divergence create deterministic blind-spot signals", () => {
  const snapshots = [snapshot(1, 100, "2026-01-01"), snapshot(2, 94, "2026-02-01", { high: 110, low: 70 })];
  const benchmarks: ConsensusBenchmarkLike[] = [
    { id: 9, symbol: "ACME", metric: "eps", fiscalPeriod: "FY2027", benchmarkKind: "company_guidance", value: null, low: 105, high: 115, effectiveAt: new Date("2026-02-02") },
    { id: 10, symbol: "ACME", metric: "eps", fiscalPeriod: "FY2027", benchmarkKind: "limuria_model", value: 120, low: null, high: null, effectiveAt: new Date("2026-02-03"), assumptionRefs: [{ label: "Volume growth", value: "8%" }] },
  ];
  const signals = buildConsensusSignals(snapshots, benchmarks);
  assert.deepEqual(signals.map((signal) => signal.signalType), ["material_revision", "widening_dispersion", "guidance_gap", "model_divergence"]);
  assert.equal(signals.at(-1)?.severity, "material");
});

test("zero consensus produces an absolute difference but no misleading percentage", () => {
  const result = compareConsensusBenchmarks([snapshot(1, 0, "2026-01-01")], [{ id: 2, symbol: "ACME", metric: "eps", fiscalPeriod: "FY2027", benchmarkKind: "limuria_model", value: 1, low: null, high: null, effectiveAt: new Date("2026-01-02") }]);
  assert.equal(result[0].difference, 1);
  assert.equal(result[0].differencePct, null);
});

test("snapshot hashes ignore object key order and change with the data", () => {
  const first = consensusSnapshotHash({ metric: "eps", values: [1, 2], source: { provider: "BYOD", asOf: "2026-01-01" } });
  const reordered = consensusSnapshotHash({ source: { asOf: "2026-01-01", provider: "BYOD" }, values: [1, 2], metric: "eps" });
  const changed = consensusSnapshotHash({ metric: "eps", values: [1, 3], source: { provider: "BYOD", asOf: "2026-01-01" } });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.notEqual(
    consensusSnapshotHash({ estimateAsOf: new Date("2026-01-01T00:00:00Z") }),
    consensusSnapshotHash({ estimateAsOf: new Date("2026-01-02T00:00:00Z") }),
  );
});
