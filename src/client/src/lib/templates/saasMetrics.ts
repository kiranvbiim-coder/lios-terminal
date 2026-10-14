/**
 * Startup / SaaS Metrics -- the recurring-revenue counterpart to a
 * traditional income-statement projection: MRR is rolled forward month by
 * month through its own components (new bookings, expansion/upsell,
 * churn) instead of being projected as a single top-line growth rate,
 * because those three drivers behave completely differently and a founder
 * or investor needs to see which one is actually doing the work. The unit-
 * economics block (LTV/CAC, runway, Rule of 40) is the set of numbers a
 * seed/Series A investor actually asks for that a generic three-statement
 * model has no rows for at all.
 */

export interface SaasMetricsInputs {
  startingMrr: number;
  monthlyNewMrr: number;      // new MRR bookings per month ($, held flat -- see template note)
  monthlyChurnPct: number;    // % of beginning MRR lost per month
  expansionMrrPct: number;    // % of beginning MRR gained via upsell/cross-sell per month
  arpaMonthly: number;        // average revenue per account, monthly ($) -- feeds the LTV calc
  cacPerCustomer: number;     // customer acquisition cost ($)
  grossMarginPct: number;
  monthlyOpex: number;        // total operating expense, $/month
  startingCash: number;
  months: number;
}

export const DEFAULT_SAAS_METRICS_INPUTS: SaasMetricsInputs = {
  startingMrr: 100000,
  monthlyNewMrr: 15000,
  monthlyChurnPct: 3,
  expansionMrrPct: 2,
  arpaMonthly: 500,
  cacPerCustomer: 1200,
  grossMarginPct: 80,
  monthlyOpex: 90000,
  startingCash: 1000000,
  months: 12,
};

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function buildSaasMetricsModel(inputs: SaasMetricsInputs = DEFAULT_SAAS_METRICS_INPUTS): Record<string, string> {
  const {
    monthlyChurnPct, expansionMrrPct, grossMarginPct, months,
  } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  const firstDataCol = 2; // column C = Month 1
  const nCols = months;

  set("A1", "STARTUP / SAAS METRICS");

  set("A3", "ASSUMPTIONS (edit these -- the model recalculates live)");
  set("A4", "Starting MRR ($)");                                set("C4", String(inputs.startingMrr));
  set("A5", "New MRR Bookings / Month ($)");                    set("C5", String(inputs.monthlyNewMrr));
  set("A6", "Monthly Churn % (of MRR)");                        set("C6", String(monthlyChurnPct));
  set("A7", "Expansion MRR % (of MRR, upsell/cross-sell)");     set("C7", String(expansionMrrPct));
  set("A8", "Average Revenue Per Account, Monthly ($)");        set("C8", String(inputs.arpaMonthly));
  set("A9", "CAC per Customer ($)");                            set("C9", String(inputs.cacPerCustomer));
  set("A10", "Gross Margin %");                                 set("C10", String(grossMarginPct));
  set("A11", "Monthly Opex ($)");                                set("C11", String(inputs.monthlyOpex));
  set("A12", "Starting Cash ($)");                               set("C12", String(inputs.startingCash));

  const startMrrCell = "$C$4", newMrrCell = "$C$5", churnCell = "$C$6", expansionCell = "$C$7";
  const marginCell = "$C$10", opexCell = "$C$11", startCashCell = "$C$12";

  for (let i = 0; i < nCols; i++) set(`${colLetter(firstDataCol + i)}14`, `Month ${i + 1}`);

  let row = 14;
  const rBegin = ++row; set(`A${row}`, "Beginning MRR");
  const rNew = ++row; set(`A${row}`, "+ New MRR");
  const rExpansion = ++row; set(`A${row}`, "+ Expansion MRR");
  const rChurn = ++row; set(`A${row}`, "- Churned MRR");
  const rEnd = ++row; set(`A${row}`, "Ending MRR");
  const rArr = ++row; set(`A${row}`, "ARR (Ending MRR x 12)");
  const rGrowth = ++row; set(`A${row}`, "MRR Growth % (MoM)");
  const rGp = ++row; set(`A${row}`, "Gross Profit");
  const rBurn = ++row; set(`A${row}`, "Net Burn (Opex - Gross Profit)");
  const rCash = ++row; set(`A${row}`, "Cash Balance");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    set(`${col}${rBegin}`, i === 0 ? `=${startMrrCell}` : `=${prevCol}${rEnd}`);
    set(`${col}${rNew}`, `=${newMrrCell}`);
    set(`${col}${rExpansion}`, `=${col}${rBegin}*${expansionCell}/100`);
    set(`${col}${rChurn}`, `=${col}${rBegin}*${churnCell}/100`);
    set(`${col}${rEnd}`, `=${col}${rBegin}+${col}${rNew}+${col}${rExpansion}-${col}${rChurn}`);
    set(`${col}${rArr}`, `=${col}${rEnd}*12`);
    set(`${col}${rGrowth}`, `=(${col}${rEnd}-${col}${rBegin})/${col}${rBegin}*100`);
    set(`${col}${rGp}`, `=${col}${rEnd}*${marginCell}/100`);
    set(`${col}${rBurn}`, `=${opexCell}-${col}${rGp}`);
    set(`${col}${rCash}`, i === 0 ? `=${startCashCell}-${col}${rBurn}` : `=${prevCol}${rCash}-${col}${rBurn}`);
  }

  const lastCol = colLetter(firstDataCol + nCols - 1);

  const rSummary = rCash + 2; set(`A${rSummary}`, "UNIT ECONOMICS & RUNWAY");
  const rLtv = rSummary + 1; set(`A${rLtv}`, "LTV (ARPA x Gross Margin % / Monthly Churn %)");
  set(`C${rLtv}`, `=C8*${marginCell}/100/(${churnCell}/100)`);
  const rLtvCac = rLtv + 1; set(`A${rLtvCac}`, "LTV / CAC (x)"); set(`C${rLtvCac}`, `=C${rLtv}/C9`);
  const rRunway = rLtvCac + 1; set(`A${rRunway}`, "Runway, Months (final cash / final net burn)");
  set(`C${rRunway}`, `=IF(${lastCol}${rBurn}<=0,"N/A -- Cash Flow Positive",${lastCol}${rCash}/${lastCol}${rBurn})`);
  const rRule40 = rRunway + 1; set(`A${rRule40}`, "Rule of 40 (final month MoM growth % + FCF margin %, illustrative)");
  set(`C${rRule40}`, `=${lastCol}${rGrowth}+(-${lastCol}${rBurn}/${lastCol}${rEnd}*100)`);

  return cells;
}
