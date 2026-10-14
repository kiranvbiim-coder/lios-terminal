import test from "node:test";
import assert from "node:assert/strict";
import { AnalyticalAssumptionRegistry } from "./analyticalAssumptions";
import { AnalyticalModelRegistry } from "./analyticalRegistry";
import { runOneWaySensitivity, runTwoWaySensitivity } from "./analyticalSensitivity";
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
    discount: { currentWaccPct: 10, currentCostOfEquityPct: 11, timing: "year-end" },
    terminal: { method: "gordon", growthPct: 3, exitMultiple: 12 },
    bridge: { netDebt: 100 },
    riskFreeRatePct: 4,
    sourceAsOf: "2026-09-10T00:00:00.000Z",
  };
}

test("assumption registry resolves model then object then portfolio then global precedence", () => {
  const assumptions = new AnalyticalAssumptionRegistry();
  assumptions.upsert("riskFreeRatePct", 4.0, { label: "RISK FREE", scope: "global", source: "observed", locked: false });
  assumptions.upsert("riskFreeRatePct", 4.2, { label: "RISK FREE", scope: "portfolio", scopeId: "PORT1", source: "analyst", locked: false });
  assumptions.upsert("riskFreeRatePct", 4.4, { label: "RISK FREE", scope: "object", scopeId: "AAPL", source: "analyst", locked: false });
  assumptions.upsert("riskFreeRatePct", 4.6, { label: "RISK FREE", scope: "model", scopeId: INSTITUTIONAL_DCF_MODEL_ID, source: "analyst", locked: false });

  assert.equal(assumptions.resolve("riskFreeRatePct")?.value, 4.0);
  assert.equal(assumptions.resolve("riskFreeRatePct", { portfolioId: "PORT1" })?.value, 4.2);
  assert.equal(assumptions.resolve("riskFreeRatePct", { portfolioId: "PORT1", objectId: "AAPL" })?.value, 4.4);
  assert.equal(assumptions.resolve("riskFreeRatePct", { portfolioId: "PORT1", objectId: "AAPL", modelId: INSTITUTIONAL_DCF_MODEL_ID })?.value, 4.6);
});

test("locked assumptions reject silent overrides", () => {
  const assumptions = new AnalyticalAssumptionRegistry();
  assumptions.upsert("terminalGrowthPct", 3, { label: "TERMINAL GROWTH", scope: "object", scopeId: "AAPL", source: "analyst", locked: true });
  assert.throws(() => assumptions.upsert("terminalGrowthPct", 4, { label: "TERMINAL GROWTH", scope: "object", scopeId: "AAPL", source: "analyst", locked: true }), /locked/);
  assumptions.upsert("terminalGrowthPct", 4, { label: "TERMINAL GROWTH", scope: "object", scopeId: "AAPL", source: "analyst", locked: true, force: true });
  assert.equal(assumptions.resolve("terminalGrowthPct", { objectId: "AAPL" })?.value, 4);
});

test("one-way DCF WACC sensitivity is decreasing", () => {
  const registry = new AnalyticalModelRegistry().register(INSTITUTIONAL_DCF_ANALYTICAL_MODEL);
  const result = runOneWaySensitivity(registry, INSTITUTIONAL_DCF_MODEL_ID, sampleDcfInput(), {
    path: "discount.currentWaccPct",
    label: "WACC",
    values: [8, 9, 10, 11, 12],
    outputId: "valuePerShare",
  }, { objectId: "AAPL" });
  assert.equal(result.points.length, 5);
  assert.equal(result.monotonic, "decreasing");
  const values = result.points.map((point) => point.outputValue);
  assert.ok(values.every((value) => typeof value === "number"));
  assert.ok((values[0] as number) > (values[4] as number));
});

test("two-way DCF sensitivity creates a full WACC/growth grid", () => {
  const registry = new AnalyticalModelRegistry().register(INSTITUTIONAL_DCF_ANALYTICAL_MODEL);
  const result = runTwoWaySensitivity(registry, INSTITUTIONAL_DCF_MODEL_ID, sampleDcfInput(), {
    x: { path: "discount.currentWaccPct", label: "WACC", values: [9, 10, 11], outputId: "valuePerShare" },
    y: { path: "terminal.growthPct", label: "TERMINAL GROWTH", values: [2, 3, 4], outputId: "valuePerShare" },
    outputId: "valuePerShare",
  }, { objectId: "AAPL" });
  assert.equal(result.cells.length, 9);
  assert.ok(result.cells.every((cell) => typeof cell.outputValue === "number"));
});
