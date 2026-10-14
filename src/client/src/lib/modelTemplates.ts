/**
 * Financial Modeling Studio -- the Three-Statement Model template.
 *
 * Seeds a SpreadsheetGrid (spreadsheetEngine.ts) with a real, formula-linked
 * three-statement model: historical columns are literal numbers pulled from
 * the same canonical financial data every other panel in this app reads
 * (the provider waterfall, keyed by shared/financialFields.ts's field
 * keys), projection columns are FORMULAS driven by a small assumptions
 * block so changing one growth-rate cell recalculates the whole model live.
 *
 * Scoped deliberately: Cash is a balancing plug (Total Assets - everything
 * else, backed out from Total Liabilities & Equity) and interest expense
 * stays flat from the last actual rather than being driven off a debt
 * schedule -- the standard way to avoid circularity (interest depends on
 * debt, debt depends on cash need, cash need depends on net income, net
 * income depends on interest) in a first-pass model. A real debt schedule
 * with revolver/circularity is future work, not something to fake here.
 */
import type { LseFinancialReport } from "./useLse";

export interface HistoricalStatements {
  income: LseFinancialReport[];
  balance: LseFinancialReport[];
  cashflow: LseFinancialReport[];
}

function parseData(rows: LseFinancialReport[]): { fiscalYear: string; data: Record<string, number> }[] {
  return rows
    .slice()
    .sort((a, b) => a.fiscal_year.localeCompare(b.fiscal_year))
    .map((r) => {
      let data: Record<string, number> = {};
      try { data = JSON.parse(r.data); } catch { /* leave empty on parse failure */ }
      return { fiscalYear: r.fiscal_year, data };
    });
}

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * Builds the cell map for a Three-Statement Model. `historicalYears` caps
 * how many actual periods to include (most recent N); `projectionYears`
 * sets how many forward periods to project. Column B is reserved for
 * labels/units where useful, so periods start at column C.
 */
export function buildThreeStatementModel(
  symbol: string,
  hist: HistoricalStatements,
  historicalYears = 3,
  projectionYears = 3,
): Record<string, string> {
  const income = parseData(hist.income).slice(-historicalYears);
  const balance = parseData(hist.balance).slice(-historicalYears);
  const cashflow = parseData(hist.cashflow).slice(-historicalYears);

  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  const nHist = Math.max(income.length, 1);
  const nCols = nHist + projectionYears;
  const firstDataCol = 2; // column C (0=A,1=B,2=C)

  // ─── Header ──────────────────────────────────────────────────────────
  set("A1", `THREE-STATEMENT MODEL -- ${symbol}`);
  for (let i = 0; i < nHist; i++) set(`${colLetter(firstDataCol + i)}2`, income[i]?.fiscalYear ? `FY${income[i].fiscalYear}` : `FY-${nHist - i}`);
  for (let i = 0; i < projectionYears; i++) set(`${colLetter(firstDataCol + nHist + i)}2`, `FY+${i + 1}E`);

  const histVal = (arr: { data: Record<string, number> }[], idx: number, key: string): number => arr[idx]?.data[key] ?? 0;
  const lastHist = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];

  // ─── Assumptions block ──────────────────────────────────────────────
  const lastRevenue = histVal(income, income.length - 1, "revenue");
  const priorRevenue = histVal(income, Math.max(income.length - 2, 0), "revenue");
  const impliedGrowth = priorRevenue > 0 ? (lastRevenue - priorRevenue) / priorRevenue : 0.05;
  const lastCogs = histVal(income, income.length - 1, "costOfRevenue");
  const cogsPct = lastRevenue > 0 ? lastCogs / lastRevenue : 0.6;
  const lastSga = histVal(income, income.length - 1, "sellingGeneralAndAdministrativeExpenses");
  const sgaPct = lastRevenue > 0 ? lastSga / lastRevenue : 0.15;
  const lastTax = histVal(income, income.length - 1, "incomeTaxExpense");
  const lastEbt = histVal(income, income.length - 1, "incomeBeforeTax");
  const taxRate = lastEbt !== 0 ? Math.min(Math.max(lastTax / lastEbt, 0), 0.5) : 0.21;
  const lastDa = histVal(cashflow, cashflow.length - 1, "depreciationAndAmortization");
  const daPct = lastRevenue > 0 ? lastDa / lastRevenue : 0.03;
  const lastCapex = Math.abs(histVal(cashflow, cashflow.length - 1, "investmentsInPropertyPlantAndEquipment"));
  const capexPct = lastRevenue > 0 ? lastCapex / lastRevenue : 0.03;

  set("A4", "ASSUMPTIONS (edit these -- the model recalculates live)");
  set("A5", "Revenue Growth %"); set("C5", (impliedGrowth * 100).toFixed(1));
  set("A6", "COGS % of Revenue"); set("C6", (cogsPct * 100).toFixed(1));
  set("A7", "SG&A % of Revenue"); set("C7", (sgaPct * 100).toFixed(1));
  set("A8", "Tax Rate %"); set("C8", (taxRate * 100).toFixed(1));
  set("A9", "D&A % of Revenue"); set("C9", (daPct * 100).toFixed(1));
  set("A10", "CapEx % of Revenue"); set("C10", (capexPct * 100).toFixed(1));

  const growthCell = "$C$5", cogsCell = "$C$6", sgaCell = "$C$7", taxCell = "$C$8", daCell = "$C$9", capexCell = "$C$10";

  // ─── Income Statement ────────────────────────────────────────────────
  let row = 13;
  set(`A${row}`, "INCOME STATEMENT");
  const rRevenue = ++row; set(`A${row}`, "Revenue");
  const rCogs = ++row; set(`A${row}`, "Cost of Revenue");
  const rGrossProfit = ++row; set(`A${row}`, "Gross Profit");
  const rSga = ++row; set(`A${row}`, "SG&A");
  const rEbit = ++row; set(`A${row}`, "EBIT");
  const rInterest = ++row; set(`A${row}`, "Interest Expense");
  const rEbt = ++row; set(`A${row}`, "Income Before Tax");
  const rTax = ++row; set(`A${row}`, "Income Tax");
  const rNetIncome = ++row; set(`A${row}`, "Net Income");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    const isHist = i < nHist;

    if (isHist) {
      set(`${col}${rRevenue}`, String(histVal(income, i, "revenue")));
      set(`${col}${rCogs}`, String(histVal(income, i, "costOfRevenue")));
      set(`${col}${rSga}`, String(histVal(income, i, "sellingGeneralAndAdministrativeExpenses")));
      set(`${col}${rInterest}`, String(histVal(income, i, "interestExpense")));
    } else {
      set(`${col}${rRevenue}`, `=${prevCol}${rRevenue}*(1+${growthCell}/100)`);
      set(`${col}${rCogs}`, `=${col}${rRevenue}*${cogsCell}/100`);
      set(`${col}${rSga}`, `=${col}${rRevenue}*${sgaCell}/100`);
      set(`${col}${rInterest}`, `=${prevCol}${rInterest}`); // held flat -- see module comment on avoiding circularity
    }
    set(`${col}${rGrossProfit}`, `=${col}${rRevenue}-${col}${rCogs}`);
    set(`${col}${rEbit}`, `=${col}${rGrossProfit}-${col}${rSga}`);
    set(`${col}${rEbt}`, `=${col}${rEbit}-${col}${rInterest}`);
    set(`${col}${rTax}`, isHist ? String(histVal(income, i, "incomeTaxExpense")) : `=${col}${rEbt}*${taxCell}/100`);
    set(`${col}${rNetIncome}`, `=${col}${rEbt}-${col}${rTax}`);
  }

  // ─── Cash Flow Statement ─────────────────────────────────────────────
  row += 2;
  set(`A${row}`, "CASH FLOW STATEMENT");
  const rCfNetIncome = ++row; set(`A${row}`, "Net Income");
  const rCfDa = ++row; set(`A${row}`, "+ D&A");
  const rCfCapex = ++row; set(`A${row}`, "- CapEx");
  const rCfFcf = ++row; set(`A${row}`, "Free Cash Flow");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const isHist = i < nHist;
    set(`${col}${rCfNetIncome}`, `=${col}${rNetIncome}`);
    set(`${col}${rCfDa}`, isHist ? String(histVal(cashflow, i, "depreciationAndAmortization")) : `=${col}${rRevenue}*${daCell}/100`);
    set(`${col}${rCfCapex}`, isHist ? String(-Math.abs(histVal(cashflow, i, "investmentsInPropertyPlantAndEquipment"))) : `=-${col}${rRevenue}*${capexCell}/100`);
    set(`${col}${rCfFcf}`, `=${col}${rCfNetIncome}+${col}${rCfDa}+${col}${rCfCapex}`);
  }

  // ─── Balance Sheet (simplified; Cash is the balancing plug) ─────────
  row += 2;
  set(`A${row}`, "BALANCE SHEET");
  const rAr = ++row; set(`A${row}`, "Accounts Receivable");
  const rInventory = ++row; set(`A${row}`, "Inventory");
  const rPpe = ++row; set(`A${row}`, "PP&E, Net");
  const rOtherAssets = ++row; set(`A${row}`, "Other Assets");
  const rAp = ++row; set(`A${row}`, "Accounts Payable");
  const rDebt = ++row; set(`A${row}`, "Total Debt");
  const rOtherLiab = ++row; set(`A${row}`, "Other Liabilities");
  const rEquityBop = ++row; set(`A${row}`, "Equity (Beginning)");
  const rEquity = ++row; set(`A${row}`, "Equity (Ending)");
  const rTotalLE = ++row; set(`A${row}`, "Total Liabilities & Equity");
  const rCash = ++row; set(`A${row}`, "Cash (plug)");
  const rTotalAssets = ++row; set(`A${row}`, "Total Assets (check)");

  const firstBalCol = colLetter(firstDataCol);
  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    const isHist = i < nHist;

    if (isHist) {
      set(`${col}${rAr}`, String(histVal(balance, i, "netReceivables")));
      set(`${col}${rInventory}`, String(histVal(balance, i, "inventory")));
      set(`${col}${rPpe}`, String(histVal(balance, i, "propertyPlantEquipmentNet")));
      set(`${col}${rOtherAssets}`, String(histVal(balance, i, "otherCurrentAssets") + histVal(balance, i, "otherNonCurrentAssets") + histVal(balance, i, "goodwill") + histVal(balance, i, "intangibleAssets") + histVal(balance, i, "longTermInvestments") + histVal(balance, i, "shortTermInvestments")));
      set(`${col}${rAp}`, String(histVal(balance, i, "accountPayables")));
      set(`${col}${rDebt}`, String(histVal(balance, i, "shortTermDebt") + histVal(balance, i, "longTermDebt")));
      set(`${col}${rOtherLiab}`, String(histVal(balance, i, "otherCurrentLiabilities") + histVal(balance, i, "otherNonCurrentLiabilities") + histVal(balance, i, "deferredRevenue") + histVal(balance, i, "deferredTaxLiabilitiesNonCurrent")));
      set(`${col}${rEquity}`, String(histVal(balance, i, "totalStockholdersEquity")));
    } else {
      // AR/Inventory/AP scale with revenue at their last historical ratio; PP&E rolls forward with capex less D&A; other lines held flat.
      set(`${col}${rAr}`, `=${col}${rRevenue}*(${firstBalCol}${rAr}/${firstBalCol}${rRevenue})`);
      set(`${col}${rInventory}`, `=${col}${rRevenue}*(${firstBalCol}${rInventory}/${firstBalCol}${rRevenue})`);
      set(`${col}${rPpe}`, `=${prevCol}${rPpe}-${col}${rCfCapex}-${col}${rCfDa}`);
      set(`${col}${rOtherAssets}`, `=${prevCol}${rOtherAssets}`);
      set(`${col}${rAp}`, `=${col}${rRevenue}*(${firstBalCol}${rAp}/${firstBalCol}${rRevenue})`);
      set(`${col}${rDebt}`, `=${prevCol}${rDebt}`);
      set(`${col}${rOtherLiab}`, `=${prevCol}${rOtherLiab}`);
      set(`${col}${rEquity}`, `=${prevCol}${rEquity}+${col}${rNetIncome}`);
    }
    set(`${col}${rEquityBop}`, i === 0 ? "0" : `=${prevCol}${rEquity}`);
    set(`${col}${rTotalLE}`, `=${col}${rAp}+${col}${rDebt}+${col}${rOtherLiab}+${col}${rEquity}`);
    set(`${col}${rCash}`, `=${col}${rTotalLE}-${col}${rAr}-${col}${rInventory}-${col}${rPpe}-${col}${rOtherAssets}`);
    set(`${col}${rTotalAssets}`, `=${col}${rCash}+${col}${rAr}+${col}${rInventory}+${col}${rPpe}+${col}${rOtherAssets}`);
  }

  return cells;
}
