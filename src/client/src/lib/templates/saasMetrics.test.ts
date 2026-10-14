import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildSaasMetricsModel, DEFAULT_SAAS_METRICS_INPUTS } from "./saasMetrics";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

// Independently simulates the same MRR roll-forward the template's formulas
// implement, so the test isn't just re-typing the template's own numbers.
function simulate(inputs: typeof DEFAULT_SAAS_METRICS_INPUTS) {
  const months: { begin: number; end: number; growthPct: number; gp: number; burn: number; cash: number }[] = [];
  let begin = inputs.startingMrr;
  let cash = inputs.startingCash;
  for (let i = 0; i < inputs.months; i++) {
    const expansion = begin * (inputs.expansionMrrPct / 100);
    const churn = begin * (inputs.monthlyChurnPct / 100);
    const end = begin + inputs.monthlyNewMrr + expansion - churn;
    const growthPct = (end - begin) / begin * 100;
    const gp = end * (inputs.grossMarginPct / 100);
    const burn = inputs.monthlyOpex - gp;
    cash = cash - burn;
    months.push({ begin, end, growthPct, gp, burn, cash });
    begin = end;
  }
  return months;
}

test("SaaS Metrics template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildSaasMetricsModel(DEFAULT_SAAS_METRICS_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("SaaS Metrics template: Month 1 MRR roll-forward matches an independent simulation of new + expansion - churn", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildSaasMetricsModel(DEFAULT_SAAS_METRICS_INPUTS));
  const sim = simulate(DEFAULT_SAAS_METRICS_INPUTS);

  // Row 15 = Beginning MRR, 19 = Ending MRR (14 is the "Month N" header row).
  approxEqual(g.getCell("C15").value as number, sim[0].begin);
  approxEqual(g.getCell("C19").value as number, sim[0].end);
  approxEqual(g.getCell("C24").value as number, sim[0].cash);
});

test("SaaS Metrics template: the full 12-month roll-forward matches the independent simulation at every month, and MRR compounds upward", () => {
  const g = new SpreadsheetGrid();
  const inputs = DEFAULT_SAAS_METRICS_INPUTS;
  feed(g, buildSaasMetricsModel(inputs));
  const sim = simulate(inputs);

  for (let i = 0; i < inputs.months; i++) {
    const col = colLetter(2 + i);
    approxEqual(g.getCell(`${col}19`).value as number, sim[i].end, 1e-4); // Ending MRR row
    approxEqual(g.getCell(`${col}24`).value as number, sim[i].cash, 1e-2); // Cash Balance row
  }
  assert.ok(sim[inputs.months - 1].end > sim[0].end, "MRR should compound upward over the year in this healthy default scenario");
});

test("SaaS Metrics template: LTV = ARPA x Gross Margin % / Monthly Churn %, and LTV/CAC divides by CAC per customer", () => {
  const g = new SpreadsheetGrid();
  const { arpaMonthly, grossMarginPct, monthlyChurnPct, cacPerCustomer } = DEFAULT_SAAS_METRICS_INPUTS;
  feed(g, buildSaasMetricsModel(DEFAULT_SAAS_METRICS_INPUTS));

  const expectedLtv = arpaMonthly * (grossMarginPct / 100) / (monthlyChurnPct / 100);
  approxEqual(g.getCell("C27").value as number, expectedLtv); // ~13,333.33
  approxEqual(g.getCell("C28").value as number, expectedLtv / cacPerCustomer);
});

test("SaaS Metrics template: Rule of 40 combines the final month's MoM growth % and FCF margin %", () => {
  const g = new SpreadsheetGrid();
  const inputs = DEFAULT_SAAS_METRICS_INPUTS;
  feed(g, buildSaasMetricsModel(inputs));
  const sim = simulate(inputs);
  const last = sim[sim.length - 1];
  const expectedRule40 = last.growthPct + (-last.burn / last.end * 100);
  approxEqual(g.getCell("C30").value as number, expectedRule40, 1e-2);
});
