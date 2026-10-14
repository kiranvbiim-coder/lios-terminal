import test from "node:test";
import assert from "node:assert/strict";
import {
  executeAnalyticalModel,
  type AnalyticalModelDefinition,
} from "./analyticalCore";
import {
  createAnalyticalRunSnapshot,
  diffAnalyticalRunSnapshots,
  summarizeAnalyticalRunDiff,
} from "./analyticalRunHistory";

interface SyntheticPayload {
  wacc: number;
  regime: string;
  source: string;
  sourceAsOf: string;
  warning?: boolean;
}

const SYNTHETIC_MODEL: AnalyticalModelDefinition<SyntheticPayload> = {
  id: "test.snapshot-model",
  label: "Snapshot Model",
  domain: "valuation",
  version: "1.0.0",
  determinism: "deterministic",
  describeInputs: (payload) => [
    { id: "wacc", label: "WACC", value: payload.wacc, unit: "%", kind: "assumption" },
    { id: "regime", label: "REGIME", value: payload.regime, kind: "scenario" },
  ],
  execute: (payload) => ({
    outputs: [
      { id: "fairValue", label: "FAIR VALUE", value: 200 - payload.wacc * 10, unit: "USD/share", role: "primary" },
      { id: "regime", label: "REGIME", value: payload.regime, role: "diagnostic" },
    ],
    diagnostics: payload.warning
      ? [{ id: "rate-watch", label: "RATE WATCH", severity: "watch", detail: "Discount rate is elevated." }]
      : [],
    evidence: [{ id: "source", label: "SOURCE", source: payload.source, asOf: payload.sourceAsOf }],
    dependencies: [{ id: "rates.curve", kind: "data", label: "Rates curve", fingerprint: payload.sourceAsOf }],
  }),
};

function payload(overrides: Partial<SyntheticPayload> = {}): SyntheticPayload {
  return {
    wacc: 10,
    regime: "base",
    source: "governed-feed",
    sourceAsOf: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

function run(input: SyntheticPayload, runAt: string) {
  return executeAnalyticalModel(SYNTHETIC_MODEL, input, { objectId: "AAPL", runAt });
}

test("snapshot creation is immutable and identical snapshots produce no material diff", () => {
  const modelRun = run(payload(), "2026-09-10T11:00:00.000Z");
  const snapshot = createAnalyticalRunSnapshot(modelRun);
  const repeatedSnapshot = createAnalyticalRunSnapshot(modelRun);

  assert.equal(snapshot.id, repeatedSnapshot.id);
  assert.equal(snapshot.reproducibilityHash, modelRun.reproducibilityHash);
  modelRun.outputs[0].value = 999;
  assert.notEqual(snapshot.outputs[0].value, 999);

  const diff = diffAnalyticalRunSnapshots(snapshot, repeatedSnapshot);
  assert.equal(diff.materialChangeCount, 0);
  assert.equal(diff.reproducibilityChanged, false);
  assert.equal(summarizeAnalyticalRunDiff(diff), "No material analytical changes.");
});

test("run diff attributes assumption and numeric output changes with deltas", () => {
  const base = createAnalyticalRunSnapshot(run(payload({ wacc: 10 }), "2026-09-10T11:00:00.000Z"));
  const next = createAnalyticalRunSnapshot(run(payload({ wacc: 11 }), "2026-09-10T11:05:00.000Z"));
  const diff = diffAnalyticalRunSnapshots(base, next);

  const wacc = diff.inputChanges.find((change) => change.id === "wacc");
  const value = diff.outputChanges.find((change) => change.id === "fairValue");
  assert.equal(wacc?.before, 10);
  assert.equal(wacc?.after, 11);
  assert.equal(wacc?.absoluteDelta, 1);
  assert.equal(value?.before, 100);
  assert.equal(value?.after, 90);
  assert.equal(value?.absoluteDelta, -10);
  assert.equal(value?.percentDelta, -10);
  assert.equal(diff.reproducibilityChanged, true);
  assert.match(summarizeAnalyticalRunDiff(diff), /input/);
  assert.match(summarizeAnalyticalRunDiff(diff), /output/);
});

test("run diff surfaces nonnumeric outputs, diagnostics, evidence and dependencies", () => {
  const base = createAnalyticalRunSnapshot(run(payload(), "2026-09-10T11:00:00.000Z"));
  const next = createAnalyticalRunSnapshot(run(payload({
    regime: "stress",
    warning: true,
    source: "alternate-governed-feed",
    sourceAsOf: "2026-09-10T11:30:00.000Z",
  }), "2026-09-10T11:30:00.000Z"));
  const diff = diffAnalyticalRunSnapshots(base, next);

  const regime = diff.outputChanges.find((change) => change.id === "regime");
  assert.equal(regime?.before, "base");
  assert.equal(regime?.after, "stress");
  assert.equal(regime?.absoluteDelta, undefined);
  assert.equal(diff.diagnosticChanges.length, 1);
  assert.equal(diff.evidenceChanges.length, 1);
  assert.equal(diff.dependencyChanges.length, 1);
  assert.ok(diff.materialChangeCount >= 4);
});

test("run diff ordering and identity are deterministic", () => {
  const base = createAnalyticalRunSnapshot(run(payload(), "2026-09-10T11:00:00.000Z"));
  const next = createAnalyticalRunSnapshot(run(payload({ wacc: 12, regime: "bear" }), "2026-09-10T12:00:00.000Z"));
  const first = diffAnalyticalRunSnapshots(base, next);
  const second = diffAnalyticalRunSnapshots(base, next);

  assert.equal(first.id, second.id);
  assert.deepEqual(first, second);
  assert.deepEqual(first.inputChanges.map((change) => change.id), [...first.inputChanges.map((change) => change.id)].sort());
});
