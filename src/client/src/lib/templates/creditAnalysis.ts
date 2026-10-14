/**
 * Credit Analysis -- the lender's-side counterpart to the equity valuation
 * templates: instead of "what is this worth," the question is "can this
 * company service its debt, and how much cushion exists before a covenant
 * breach." Built around the two ratio families every credit agreement
 * actually gates on -- leverage (how much debt relative to cash-generating
 * capacity) and coverage (how comfortably operating cash flow covers debt
 * service) -- plus the headroom against each covenant threshold, since
 * "compliant today" and "comfortably compliant" are very different credit
 * stories. The profile band at the bottom is explicitly labeled as an
 * illustrative simplification, not a claim to reproduce any rating
 * agency's actual (much more elaborate, qualitative-plus-quantitative)
 * methodology.
 */

export interface CreditAnalysisInputs {
  ebitda: number;
  ebit: number;
  totalDebt: number;
  cash: number;
  interestExpense: number;
  scheduledPrincipalRepayment: number;
  capex: number;
  cashTaxes: number;
  maxLeverageCovenant: number; // x, Total Debt/EBITDA ceiling
  minCoverageCovenant: number; // x, EBITDA/Interest floor
}

export const DEFAULT_CREDIT_ANALYSIS_INPUTS: CreditAnalysisInputs = {
  ebitda: 500,
  ebit: 400,
  totalDebt: 1500,
  cash: 200,
  interestExpense: 90,
  scheduledPrincipalRepayment: 100,
  capex: 120,
  cashTaxes: 60,
  maxLeverageCovenant: 4.5,
  minCoverageCovenant: 3.0,
};

export function buildCreditAnalysisModel(inputs: CreditAnalysisInputs = DEFAULT_CREDIT_ANALYSIS_INPUTS): Record<string, string> {
  const {
    ebitda, ebit, totalDebt, cash, interestExpense, scheduledPrincipalRepayment,
    capex, cashTaxes, maxLeverageCovenant, minCoverageCovenant,
  } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  set("A1", "CREDIT ANALYSIS");

  set("A3", "INPUTS (edit these -- the model recalculates live)");
  set("A4", "EBITDA ($M)");                                     set("C4", String(ebitda));
  set("A5", "EBIT ($M)");                                       set("C5", String(ebit));
  set("A6", "Total Debt ($M)");                                 set("C6", String(totalDebt));
  set("A7", "Cash ($M)");                                       set("C7", String(cash));
  set("A8", "Interest Expense ($M)");                           set("C8", String(interestExpense));
  set("A9", "Scheduled Principal Repayment ($M)");              set("C9", String(scheduledPrincipalRepayment));
  set("A10", "CapEx ($M)");                                     set("C10", String(capex));
  set("A11", "Cash Taxes ($M)");                                set("C11", String(cashTaxes));
  set("A12", "Max Leverage Covenant (x, Total Debt/EBITDA)");   set("C12", String(maxLeverageCovenant));
  set("A13", "Min Coverage Covenant (x, EBITDA/Interest)");     set("C13", String(minCoverageCovenant));

  set("A15", "LEVERAGE");
  const rNetDebt = 16; set(`A${rNetDebt}`, "Net Debt (Total Debt - Cash)"); set(`C${rNetDebt}`, "=C6-C7");
  const rLeverage = 17; set(`A${rLeverage}`, "Total Debt / EBITDA (x)"); set(`C${rLeverage}`, "=C6/C4");
  const rNetLeverage = 18; set(`A${rNetLeverage}`, "Net Debt / EBITDA (x)"); set(`C${rNetLeverage}`, `=C${rNetDebt}/C4`);

  set("A20", "COVERAGE");
  const rCoverage = 21; set(`A${rCoverage}`, "EBITDA / Interest Expense (x)"); set(`C${rCoverage}`, "=C4/C8");
  const rCapexCoverage = 22; set(`A${rCapexCoverage}`, "(EBITDA - CapEx) / Interest Expense (x)"); set(`C${rCapexCoverage}`, "=(C4-C10)/C8");
  const rDebtService = 23; set(`A${rDebtService}`, "Total Debt Service (Interest + Scheduled Principal)"); set(`C${rDebtService}`, "=C8+C9");
  const rFcf = 24; set(`A${rFcf}`, "FCF Before Debt Service (EBITDA - CapEx - Cash Taxes)"); set(`C${rFcf}`, "=C4-C10-C11");
  const rFcfCoverage = 25; set(`A${rFcfCoverage}`, "FCF / Total Debt Service (x)"); set(`C${rFcfCoverage}`, `=C${rFcf}/C${rDebtService}`);

  set("A27", "COVENANT HEADROOM");
  const rLevHeadroom = 28; set(`A${rLevHeadroom}`, "Leverage Headroom (Max Covenant - Actual, x)"); set(`C${rLevHeadroom}`, `=C12-C${rLeverage}`);
  const rLevHeadroomPct = 29; set(`A${rLevHeadroomPct}`, "Leverage Headroom %"); set(`C${rLevHeadroomPct}`, `=C${rLevHeadroom}/C12*100`);
  const rCovHeadroom = 30; set(`A${rCovHeadroom}`, "Coverage Headroom (Actual - Min Covenant, x)"); set(`C${rCovHeadroom}`, `=C${rCoverage}-C13`);
  const rCovHeadroomPct = 31; set(`A${rCovHeadroomPct}`, "Coverage Headroom %"); set(`C${rCovHeadroomPct}`, `=C${rCovHeadroom}/C13*100`);

  set("A33", "ILLUSTRATIVE CREDIT PROFILE (a simplified framework, not an agency rating methodology)");
  const rProfile = 34;
  set(`A${rProfile}`, "Profile Band");
  set(`C${rProfile}`,
    `=IF(AND(C${rLeverage}<=2,C${rCoverage}>=8),"A / Strong",IF(AND(C${rLeverage}<=3.5,C${rCoverage}>=5),"BBB / Adequate",IF(AND(C${rLeverage}<=5,C${rCoverage}>=3),"BB / Speculative","B or Below / High Risk")))`);

  return cells;
}
