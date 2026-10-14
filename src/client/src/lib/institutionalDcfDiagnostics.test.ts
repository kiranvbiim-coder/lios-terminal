import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDcfDriverImpacts,
  buildDcfSensitivitySurface,
  solveReverseDcfExplicitGrowth,
  solveReverseDcfTerminalGrowth,
} from "./institutionalDcfDiagnostics";
import { runInstitutionalDcf, type InstitutionalDcfInput } from "./institutionalDcf";

function fixture(): InstitutionalDcfInput {
  return {
    baseRevenue: 1_000,
    basicShares: 100,
    dilutedShares: 100,
    spotPrice: 10,
    startingInvestedCapital: 600,
    startingNetDebt: 200,
    startingNopat: 96,
    cashFlowMode: "fcff",
    years: Array.from({ length: 5 }, () => ({
      revenueGrowthPct: 8,
      ebitdaMarginPct: 25,
      daPctRevenue: 5,
      taxRatePct: 20,
      capexPctRevenue: 8,
      nwcInvestmentPctRevenue: 2,
      netBorrowing: 0,
      costOfDebtPct: 5,
    })),
    discount: {
      currentWaccPct: 9,
      terminalWaccPct: 8.5,
      currentCostOfEquityPct: 11,
      terminalCostOfEquityPct: 10.5,
      maturityFadeYears: 5,
      timing: "mid-year",
    },
    terminal: { method: "gordon", growthPct: 2.5, exitMultiple: 10 },
    bridge: { netDebt: 200 },
    riskFreeRatePct: 4.5,
  };
}

test("two-way sensitivity moves valuation in the expected directions", () => {
  const surface = buildDcfSensitivitySurface(fixture(), [-1, 0, 1], [-0.5, 0, 0.5]);
  assert.equal(surface.cells.length, 3);
  assert.equal(surface.cells[0].length, 3);
  const lowDiscount = surface.cells[1][0].valuePerShare!;
  const base = surface.cells[1][1].valuePerShare!;
  const highDiscount = surface.cells[1][2].valuePerShare!;
  assert.ok(lowDiscount > base);
  assert.ok(base > highDiscount);
  const lowGrowth = surface.cells[0][1].valuePerShare!;
  const highGrowth = surface.cells[2][1].valuePerShare!;
  assert.ok(highGrowth > lowGrowth);
});

test("reverse DCF explicit-growth solver recovers a known uniform shock", () => {
  const input = fixture();
  const knownShock = 4;
  const shockedValue = runInstitutionalDcf({
    ...input,
    years: input.years.map(year => ({ ...year, revenueGrowthPct: year.revenueGrowthPct + knownShock })),
  }).valuePerShare!;
  input.spotPrice = shockedValue;
  const solved = solveReverseDcfExplicitGrowth(input, [-10, 15]);
  assert.equal(solved.status, "solved");
  assert.ok(Math.abs(solved.solvedValue! - knownShock) < 1e-4);
  assert.ok(Math.abs(solved.impliedValuePerShare! - shockedValue) < 1e-4);
});

test("reverse DCF terminal-growth solver recovers a known Gordon rate", () => {
  const input = fixture();
  const knownGrowth = 3.2;
  const target = runInstitutionalDcf({ ...input, terminal: { ...input.terminal, method: "gordon", growthPct: knownGrowth } }).valuePerShare!;
  input.spotPrice = target;
  const solved = solveReverseDcfTerminalGrowth(input);
  assert.equal(solved.status, "solved");
  assert.ok(Math.abs(solved.solvedValue! - knownGrowth) < 1e-4);
});

test("driver impacts preserve economically sensible signs", () => {
  const impacts = buildDcfDriverImpacts(fixture());
  const byDriver = new Map(impacts.map(impact => [impact.driver, impact]));
  assert.ok(byDriver.get("revenue-growth")!.absoluteImpactPerShare! > 0);
  assert.ok(byDriver.get("ebitda-margin")!.absoluteImpactPerShare! > 0);
  assert.ok(byDriver.get("capex")!.absoluteImpactPerShare! < 0);
  assert.ok(byDriver.get("working-capital")!.absoluteImpactPerShare! < 0);
  assert.ok(byDriver.get("discount-rate")!.absoluteImpactPerShare! < 0);
  assert.ok(byDriver.get("terminal-growth")!.absoluteImpactPerShare! > 0);
});

test("reverse DCF reports unavailability when spot is missing", () => {
  const input = fixture();
  input.spotPrice = null;
  const solved = solveReverseDcfExplicitGrowth(input);
  assert.equal(solved.status, "unavailable");
  assert.equal(solved.solvedValue, null);
});
