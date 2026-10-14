/**
 * Project Finance -- the infrastructure/energy-project counterpart to a
 * corporate model: value and risk sit almost entirely in whether the
 * project's own cash flows can service a large upfront debt raise, not in
 * a going-concern enterprise's blended capital structure. Two things make
 * this genuinely different from a corporate model: a Sources & Uses table
 * that sizes debt off construction cost (including capitalized interest
 * during construction, since no revenue exists yet to service it), and a
 * DSCR (Debt Service Coverage Ratio) test every single operating year --
 * the actual covenant lenders gate on, not a single blended leverage
 * multiple. The debt schedule here is intentionally a straight-line
 * amortization against a fixed tenor (the standard project-finance
 * convention) rather than the cash-sweep schedule the LBO template uses --
 * project debt is sized to a repayment schedule up front, not swept
 * opportunistically.
 */

export interface ProjectFinanceInputs {
  constructionCost: number;
  contingencyPct: number;
  gearingPct: number;          // % of base uses (construction + contingency) funded by senior debt
  interestRatePct: number;
  constructionMonths: number;  // used for a simplified average-drawdown IDC calc
  financingFeesPct: number;    // % of debt, capitalized upfront financing fee
  operatingYears: number;
  debtTenorYears: number;      // straight-line amortization period for the senior debt
  annualRevenueYear1: number;
  revenueGrowthPct: number;
  annualOpexYear1: number;
  opexGrowthPct: number;
  minDscrCovenant: number;     // x, minimum Debt Service Coverage Ratio required
}

export const DEFAULT_PROJECT_FINANCE_INPUTS: ProjectFinanceInputs = {
  constructionCost: 800,
  contingencyPct: 10,
  gearingPct: 70,
  interestRatePct: 7,
  constructionMonths: 24,
  financingFeesPct: 1.5,
  operatingYears: 10,
  debtTenorYears: 10,
  annualRevenueYear1: 300,
  revenueGrowthPct: 2,
  annualOpexYear1: 100,
  opexGrowthPct: 2,
  minDscrCovenant: 1.2,
};

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function buildProjectFinanceModel(inputs: ProjectFinanceInputs = DEFAULT_PROJECT_FINANCE_INPUTS): Record<string, string> {
  const {
    constructionCost, contingencyPct, gearingPct, interestRatePct, constructionMonths, financingFeesPct,
    operatingYears, debtTenorYears, annualRevenueYear1, revenueGrowthPct, annualOpexYear1, opexGrowthPct, minDscrCovenant,
  } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  set("A1", "PROJECT FINANCE MODEL");

  set("A3", "CONSTRUCTION ASSUMPTIONS (edit these -- the model recalculates live)");
  set("A4", "Construction Cost ($M)");                        set("C4", String(constructionCost));
  set("A5", "Contingency %");                                 set("C5", String(contingencyPct));
  set("A6", "Debt Gearing % (of base uses)");                 set("C6", String(gearingPct));
  set("A7", "Interest Rate %");                                set("C7", String(interestRatePct));
  set("A8", "Construction Period (months)");                  set("C8", String(constructionMonths));
  set("A9", "Financing Fees % (of debt)");                    set("C9", String(financingFeesPct));
  set("A10", "Debt Tenor (years, straight-line amortization)"); set("C10", String(debtTenorYears));
  set("A11", "Min DSCR Covenant (x)");                        set("C11", String(minDscrCovenant));

  set("A13", "OPERATING ASSUMPTIONS");
  set("A14", "Year 1 Revenue ($M)");        set("C14", String(annualRevenueYear1));
  set("A15", "Revenue Growth % / Year");    set("C15", String(revenueGrowthPct));
  set("A16", "Year 1 Opex ($M)");           set("C16", String(annualOpexYear1));
  set("A17", "Opex Growth % / Year");       set("C17", String(opexGrowthPct));

  // ─── Sources & Uses -- a single-pass chain (Base Uses -> Debt -> IDC/
  // Fees -> Total Uses -> Equity plug), deliberately not circular: debt is
  // sized off base construction cost, and equity absorbs everything else. ──
  set("A19", "SOURCES & USES");
  const rBaseUses = 20; set(`A${rBaseUses}`, "Base Uses (Construction Cost + Contingency)"); set(`C${rBaseUses}`, "=C4*(1+C5/100)");
  const rDebt = 21; set(`A${rDebt}`, "Senior Debt (Base Uses x Gearing %)"); set(`C${rDebt}`, `=C${rBaseUses}*C6/100`);
  const rIdc = 22; set(`A${rIdc}`, "Interest During Construction (avg 50% drawdown)"); set(`C${rIdc}`, `=C${rDebt}*C7/100*(C8/12)*0.5`);
  const rFees = 23; set(`A${rFees}`, "Financing Fees"); set(`C${rFees}`, `=C${rDebt}*C9/100`);
  const rTotalUses = 24; set(`A${rTotalUses}`, "TOTAL USES"); set(`C${rTotalUses}`, `=C${rBaseUses}+C${rIdc}+C${rFees}`);
  const rEquity = 25; set(`A${rEquity}`, "Equity (plug: Total Uses - Debt)"); set(`C${rEquity}`, `=C${rTotalUses}-C${rDebt}`);

  // ─── Operating period: revenue, opex, debt service, DSCR ────────────
  const firstDataCol = 2; // column C = Year 1
  const nCols = operatingYears;
  for (let i = 0; i < nCols; i++) set(`${colLetter(firstDataCol + i)}27`, `Year ${i + 1}`);

  let row = 27;
  const rRevenue = ++row; set(`A${row}`, "Revenue");
  const rOpex = ++row; set(`A${row}`, "Opex");
  const rCfads = ++row; set(`A${row}`, "CFADS (Revenue - Opex)");
  const rBeginBal = ++row; set(`A${row}`, "Beginning Debt Balance");
  const rPrincipal = ++row; set(`A${row}`, "Principal Repayment (straight-line)");
  const rInterest = ++row; set(`A${row}`, "Interest (on beginning balance)");
  const rDebtService = ++row; set(`A${row}`, "Total Debt Service");
  const rEndBal = ++row; set(`A${row}`, "Ending Debt Balance");
  const rDscr = ++row; set(`A${row}`, "DSCR (CFADS / Debt Service)");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    set(`${col}${rRevenue}`, i === 0 ? "=C14" : `=${prevCol}${rRevenue}*(1+C15/100)`);
    set(`${col}${rOpex}`, i === 0 ? "=C16" : `=${prevCol}${rOpex}*(1+C17/100)`);
    set(`${col}${rCfads}`, `=${col}${rRevenue}-${col}${rOpex}`);
    set(`${col}${rBeginBal}`, i === 0 ? `=C${rDebt}` : `=${prevCol}${rEndBal}`);
    set(`${col}${rPrincipal}`, `=MIN(${col}${rBeginBal},C${rDebt}/C10)`);
    set(`${col}${rInterest}`, `=${col}${rBeginBal}*C7/100`);
    set(`${col}${rDebtService}`, `=${col}${rPrincipal}+${col}${rInterest}`);
    set(`${col}${rEndBal}`, `=${col}${rBeginBal}-${col}${rPrincipal}`);
    set(`${col}${rDscr}`, `=${col}${rCfads}/${col}${rDebtService}`);
  }

  const lastCol = colLetter(firstDataCol + nCols - 1);
  const rMinDscr = rDscr + 2; set(`A${rMinDscr}`, "MINIMUM DSCR OVER THE OPERATING PERIOD");
  set(`C${rMinDscr}`, `=MIN(${colLetter(firstDataCol)}${rDscr}:${lastCol}${rDscr})`);
  const rCovenantTest = rMinDscr + 1; set(`A${rCovenantTest}`, "COVENANT TEST (Min DSCR vs Min DSCR Covenant)");
  set(`C${rCovenantTest}`, `=IF(C${rMinDscr}>=C11,"PASS","FAIL")`);

  return cells;
}
