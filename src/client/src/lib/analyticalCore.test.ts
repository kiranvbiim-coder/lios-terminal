import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticalFingerprint,
  executeAnalyticalModel,
  type AnalyticalModelDefinition,
  type AnalyticalModelRun,
} from "./analyticalCore";
import { AnalyticalGraph, mergeRunIntoAnalyticalGraph } from "./analyticalGraph";
import { buildAnalyticalEnsemble } from "./analyticalEnsemble";
import { AnalyticalModelRegistry } from "./analyticalRegistry";
import { applyAnalyticalScenario, type AnalyticalScenario } from "./analyticalScenario";
import {
  INSTITUTIONAL_DCF_ANALYTICAL_MODEL,
  INSTITUTIONAL_DCF_MODEL_ID,
} from "./institutionalDcfAnalyticalAdapter";
import type { InstitutionalDcfInput } from "./institutionalDcf";

function sampleDcfInput(): InstitutionalDcfInput {
  return {
    baseRevenue: 1_000,
    basicShares: 100,
    dilutedShares: 100,
    spotPrice: 10,
    startingInvestedCapital: 500,
    startingNetDebt: 100,
    startingNopat: 100,
    cashFlowMode: "fcff",
    years: Array.from({ length: 5 }, () => ({
      revenueGrowthPct: 6,
      ebitdaMarginPct: 30,
      daPctRevenue: 4,
      taxRatePct: 20,
      capexPctRevenue: 5,
      nwcInvestmentPctRevenue: 1,
    })),
    discount: {
      currentWaccPct: 10,
      currentCostOfEquityPct: 11,
      timing: "year-end",
    },
    terminal: {
      method: "gordon",
      growthPct: 3,
      exitMultiple: 12,
    },
    bridge: {
      netDebt: 100,
    },
    riskFreeRatePct: 4,
    sourceAsOf: "2026-09-10T00:00:00.000Z",
  };
}

test("analytical fingerprints are stable across object key order", () => {
  assert.equal(
    analyticalFingerprint({ b: 2, a: { y: 4, x: 3 } }),
    analyticalFingerprint({ a: { x: 3, y: 4 }, b: 2 }),
  );
  assert.notEqual(analyticalFingerprint({ a: 1 }), analyticalFingerprint({ a: 2 }));
});

test("scenario engine shocks wildcard forecast assumptions without mutating the source payload", () => {
  const payload = sampleDcfInput();
  const scenario: AnalyticalScenario = {
    id: "rates-up-growth-down",
    label: "RATES UP / GROWTH DOWN",
    shocks: [
      { id: "wacc", label: "WACC +100bp", path: "discount.currentWaccPct", operation: "add", value: 100, unit: "basis-points" },
      { id: "growth", label: "Growth -2pp", path: "years.*.revenueGrowthPct", operation: "add", value: -2, unit: "percentage-points" },
    ],
  };
  const applied = applyAnalyticalScenario(payload, scenario);
  assert.equal(payload.discount.currentWaccPct, 10);
  assert.equal(payload.years[0].revenueGrowthPct, 6);
  assert.equal(applied.payload.discount.currentWaccPct, 11);
  assert.ok(applied.payload.years.every((year) => year.revenueGrowthPct === 4));
  assert.equal(applied.changes.length, 6);
});

test("institutional DCF runs through the shared registry with reproducible lineage", () => {
  const registry = new AnalyticalModelRegistry().register(INSTITUTIONAL_DCF_ANALYTICAL_MODEL);
  const input = sampleDcfInput();
  const base = registry.run(INSTITUTIONAL_DCF_MODEL_ID, input, {
    objectId: "AAPL",
    runAt: "2026-09-10T10:00:00.000Z",
  }).run;
  const repeated = registry.run(INSTITUTIONAL_DCF_MODEL_ID, input, {
    objectId: "AAPL",
    runAt: "2026-09-10T10:01:00.000Z",
  }).run;

  assert.equal(base.status, "success");
  assert.equal(base.reproducibilityHash, repeated.reproducibilityHash);
  assert.equal(base.inputFingerprint, repeated.inputFingerprint);
  assert.ok(base.outputs.some((output) => output.id === "valuePerShare" && typeof output.value === "number"));
  assert.ok(base.diagnostics.some((diagnostic) => diagnostic.id === "tv-share"));
  assert.equal(base.evidence[0]?.asOf, input.sourceAsOf);

  const graph = mergeRunIntoAnalyticalGraph(new AnalyticalGraph(), base);
  const waccNode = `input:${base.id}:discount.currentWaccPct`;
  const impact = graph.impactFrom([waccNode]);
  assert.ok(impact.impactedModels.some((id) => id.includes(INSTITUTIONAL_DCF_MODEL_ID)));
  assert.ok(impact.impactedOutputs.some((id) => id.endsWith(":valuePerShare")));
  assert.ok(graph.topologicalOrder().length > base.outputs.length);
});

test("a +100bp DCF discount-rate scenario reduces implied value", () => {
  const registry = new AnalyticalModelRegistry().register(INSTITUTIONAL_DCF_ANALYTICAL_MODEL);
  const input = sampleDcfInput();
  const base = registry.run(INSTITUTIONAL_DCF_MODEL_ID, input, { objectId: "AAPL" }).run;
  const rateShock: AnalyticalScenario = {
    id: "rates-plus-100",
    label: "RATES +100BP",
    shocks: [{ id: "wacc", label: "WACC +100bp", path: "discount.currentWaccPct", operation: "add", value: 100, unit: "basis-points" }],
  };
  const shocked = registry.run(INSTITUTIONAL_DCF_MODEL_ID, input, { objectId: "AAPL", scenario: rateShock });
  const baseValue = base.outputs.find((output) => output.id === "valuePerShare")?.value;
  const shockedValue = shocked.run.outputs.find((output) => output.id === "valuePerShare")?.value;
  assert.equal(shocked.scenarioChanges.length, 1);
  assert.equal(shocked.run.scenarioId, rateShock.id);
  assert.equal(typeof baseValue, "number");
  assert.equal(typeof shockedValue, "number");
  assert.ok((shockedValue as number) < (baseValue as number));
});

function syntheticRun(modelId: string, value: number): AnalyticalModelRun {
  const definition: AnalyticalModelDefinition<number> = {
    id: modelId,
    label: modelId.toUpperCase(),
    domain: "valuation",
    version: "1.0.0",
    determinism: "deterministic",
    describeInputs: (payload) => [{ id: "seed", label: "SEED VALUE", value: payload, kind: "assumption" }],
    execute: (payload) => ({ outputs: [{ id: "fairValue", label: "FAIR VALUE", value: payload, unit: "USD/share", role: "primary" }] }),
  };
  return executeAnalyticalModel(definition, value, { objectId: "AAPL", runAt: `2026-09-10T10:0${modelId.length}:00.000Z` });
}

test("ensemble engine exposes consensus, dispersion and robust model outliers", () => {
  const result = buildAnalyticalEnsemble([
    syntheticRun("dcf", 100),
    syntheticRun("residual-income", 105),
    syntheticRun("extreme-model", 300),
  ]);
  assert.equal(result.rows.length, 3);
  assert.ok(result.consensusValue !== null && result.consensusValue > 100);
  assert.ok(result.dispersionPct !== null && result.dispersionPct > 0);
  assert.ok(result.outlierModelIds.includes("extreme-model"));
  assert.ok(result.confidenceScore >= 0 && result.confidenceScore <= 1);
});
