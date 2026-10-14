/**
 * Adjusted Present Value (APV) -- splits enterprise value into two additive
 * pieces instead of DCF's single blended-WACC discount rate: the value of
 * the business AS IF unlevered (all-equity, discounted at the unlevered
 * cost of equity Ku) plus the value the debt itself adds via the interest
 * tax shield (discounted separately, at the cost of debt Kd -- the standard
 * practitioner convention for a debt balance assumed constant in dollar
 * terms). This matters whenever leverage changes materially over the
 * projection (LBOs, turnarounds, recaps) -- exactly where a single blended
 * WACC stops being valid, since WACC itself depends on a capital structure
 * that isn't holding still.
 */

export interface ApvInputs {
  baseUnleveredFcf: number;          // Year 1 unlevered FCF
  fcfGrowthPct: number;              // annual growth during the explicit projection
  terminalGrowthPct: number;         // perpetuity growth rate beyond the projection
  unleveredCostOfEquityPct: number;  // Ku -- the all-equity discount rate
  debtBalance: number;               // assumed constant debt balance funding the tax shield
  costOfDebtPct: number;             // Kd -- also the discount rate applied to the tax shield
  taxRatePct: number;
  netDebt: number;                   // for the equity value bridge (can differ from debtBalance if there's non-interest-bearing debt or excess cash)
  projectionYears: number;
}

export const DEFAULT_APV_INPUTS: ApvInputs = {
  baseUnleveredFcf: 100,
  fcfGrowthPct: 6,
  terminalGrowthPct: 2.5,
  unleveredCostOfEquityPct: 11,
  debtBalance: 300,
  costOfDebtPct: 6,
  taxRatePct: 25,
  netDebt: 250,
  projectionYears: 5,
};

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function buildApvModel(inputs: ApvInputs = DEFAULT_APV_INPUTS): Record<string, string> {
  const {
    fcfGrowthPct, terminalGrowthPct, unleveredCostOfEquityPct,
    debtBalance, costOfDebtPct, taxRatePct, netDebt, projectionYears,
  } = inputs;

  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  const firstDataCol = 2; // column C = Year 1
  const nCols = projectionYears;

  set("A1", "ADJUSTED PRESENT VALUE (APV)");

  set("A3", "ASSUMPTIONS (edit these -- the model recalculates live)");
  set("A4", "Base Unlevered FCF ($M, Year 1)");       set("C4", String(inputs.baseUnleveredFcf));
  set("A5", "FCF Growth % (explicit period)");        set("C5", String(fcfGrowthPct));
  set("A6", "Terminal Growth %");                     set("C6", String(terminalGrowthPct));
  set("A7", "Unlevered Cost of Equity % (Ku)");       set("C7", String(unleveredCostOfEquityPct));
  set("A8", "Debt Balance ($M, assumed constant)");   set("C8", String(debtBalance));
  set("A9", "Cost of Debt % (Kd)");                   set("C9", String(costOfDebtPct));
  set("A10", "Tax Rate %");                           set("C10", String(taxRatePct));
  set("A11", "Net Debt ($M, for equity bridge)");     set("C11", String(netDebt));

  const growthCell = "$C$5", termGrowthCell = "$C$6", kuCell = "$C$7";
  const debtCell = "$C$8", kdCell = "$C$9", taxCell = "$C$10", netDebtCell = "$C$11";

  for (let i = 0; i < nCols; i++) set(`${colLetter(firstDataCol + i)}13`, `Year ${i + 1}`);

  let row = 13;
  const rFcf = ++row; set(`A${row}`, "Unlevered FCF");
  const rDf = ++row; set(`A${row}`, "Discount Factor @ Ku");
  const rPv = ++row; set(`A${row}`, "PV of Unlevered FCF");
  const rShield = ++row; set(`A${row}`, "Interest Tax Shield");
  const rDfKd = ++row; set(`A${row}`, "Discount Factor @ Kd");
  const rPvShield = ++row; set(`A${row}`, "PV of Tax Shield");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    const period = i + 1;
    set(`${col}${rFcf}`, i === 0 ? "=C4" : `=${prevCol}${rFcf}*(1+${growthCell}/100)`);
    set(`${col}${rDf}`, `=1/(1+${kuCell}/100)^${period}`);
    set(`${col}${rPv}`, `=${col}${rFcf}*${col}${rDf}`);
    set(`${col}${rShield}`, `=${debtCell}*${kdCell}/100*${taxCell}/100`);
    set(`${col}${rDfKd}`, `=1/(1+${kdCell}/100)^${period}`);
    set(`${col}${rPvShield}`, `=${col}${rShield}*${col}${rDfKd}`);
  }

  const lastCol = colLetter(firstDataCol + nCols - 1);

  const rSumPvFcf = rPvShield + 2; set(`A${rSumPvFcf}`, "Sum PV of Unlevered FCF (explicit period)");
  set(`C${rSumPvFcf}`, `=SUM(${colLetter(firstDataCol)}${rPv}:${lastCol}${rPv})`);

  const rTvFcf = rSumPvFcf + 1; set(`A${rTvFcf}`, "Terminal Value of Unlevered FCF (Gordon growth)");
  set(`C${rTvFcf}`, `=${lastCol}${rFcf}*(1+${termGrowthCell}/100)/(${kuCell}/100-${termGrowthCell}/100)`);

  const rPvTvFcf = rTvFcf + 1; set(`A${rPvTvFcf}`, "PV of Terminal Value");
  set(`C${rPvTvFcf}`, `=C${rTvFcf}*${lastCol}${rDf}`);

  const rSumPvShield = rPvTvFcf + 1; set(`A${rSumPvShield}`, "Sum PV of Tax Shield (explicit period)");
  set(`C${rSumPvShield}`, `=SUM(${colLetter(firstDataCol)}${rPvShield}:${lastCol}${rPvShield})`);

  const rUnleveredValue = rSumPvShield + 2; set(`A${rUnleveredValue}`, "UNLEVERED VALUE (PV of FCF + PV of TV)");
  set(`C${rUnleveredValue}`, `=C${rSumPvFcf}+C${rPvTvFcf}`);

  const rApv = rUnleveredValue + 1; set(`A${rApv}`, "APV = Unlevered Value + PV of Tax Shield");
  set(`C${rApv}`, `=C${rUnleveredValue}+C${rSumPvShield}`);

  const rEquity = rApv + 2; set(`A${rEquity}`, "Implied Equity Value (APV - Net Debt)");
  set(`C${rEquity}`, `=C${rApv}-${netDebtCell}`);

  return cells;
}
