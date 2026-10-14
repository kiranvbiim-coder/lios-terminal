/**
 * LBO Debt Paydown Model -- roadmap item #19 ("a real LBO template with a
 * real debt schedule"), previously blocked on the engine not supporting
 * circular references. Now that iterative calculation exists
 * (spreadsheetEngine.ts's SpreadsheetGrid.setIterativeMode), the textbook
 * circular interest calculation (interest on the average of beginning/
 * ending balance, which depends on the cash sweep, which depends on
 * interest) can be built for real instead of faked with a flat interest
 * assumption.
 *
 * Unlike the Three-Statement Model, this template is forward-looking and
 * assumption-driven rather than seeded from historical financials -- an
 * LBO plan starts at deal close with a transaction structure (entry EBIT,
 * purchase leverage, financing terms), not a company's reported history.
 * That's a deliberate difference in input shape from buildThreeStatementModel,
 * which the template registry (templateRegistry.ts) is built to accommodate.
 */
import { buildDebtSchedule, type PeriodAxis } from "@/lib/scheduleBuilders";

export interface LboDebtPaydownInputs {
  entryEbit: number;         // Year 0 EBIT at deal close
  ebitGrowthPct: number;     // annual EBIT growth %
  entryDebtMultiple: number; // entry Debt / EBIT (a simple stand-in for Debt/EBITDA at this level of detail)
  interestRatePct: number;   // blended interest rate on the debt balance
  taxRatePct: number;
  daPctOfEbit: number;       // D&A as % of EBIT -- add-back to get to cash flow
  capexPctOfEbit: number;    // CapEx as % of EBIT -- cash outflow
  mandatoryAmortPct: number; // % of ORIGINAL principal amortized per year (0 for a pure cash-sweep structure)
  projectionYears: number;
}

export const DEFAULT_LBO_INPUTS: LboDebtPaydownInputs = {
  entryEbit: 100,
  ebitGrowthPct: 8,
  entryDebtMultiple: 5, // 5.0x Debt/EBIT at entry -- a middle-of-the-road LBO leverage level
  interestRatePct: 8,
  taxRatePct: 25,
  daPctOfEbit: 15,
  capexPctOfEbit: 12,
  mandatoryAmortPct: 5,
  projectionYears: 5,
};

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function buildLboDebtPaydownModel(inputs: LboDebtPaydownInputs = DEFAULT_LBO_INPUTS): Record<string, string> {
  const { entryEbit, ebitGrowthPct, entryDebtMultiple, interestRatePct, taxRatePct, daPctOfEbit, capexPctOfEbit, mandatoryAmortPct, projectionYears } = inputs;

  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  const firstDataCol = 2; // column C = Year 1
  const nCols = projectionYears;
  const axis: PeriodAxis = { firstDataCol, nHistCols: 0, nProjCols: nCols };

  set("A1", "LBO DEBT PAYDOWN MODEL");

  // ─── Assumptions ───────────────────────────────────────────────────────
  set("A3", "ASSUMPTIONS (edit these -- the model recalculates live)");
  set("A4", "Entry EBIT ($M)");              set("C4", String(entryEbit));
  set("A5", "EBIT Growth %");                set("C5", String(ebitGrowthPct));
  set("A6", "Entry Debt / EBIT (x)");        set("C6", String(entryDebtMultiple));
  set("A7", "Interest Rate %");              set("C7", String(interestRatePct));
  set("A8", "Tax Rate %");                   set("C8", String(taxRatePct));
  set("A9", "D&A % of EBIT");                set("C9", String(daPctOfEbit));
  set("A10", "CapEx % of EBIT");             set("C10", String(capexPctOfEbit));
  set("A11", "Mandatory Amort % of Original Principal"); set("C11", String(mandatoryAmortPct));
  const [ebitGrowthCell, taxCell, daCell, capexCell] = ["$C$5", "$C$8", "$C$9", "$C$10"];
  const interestRateCell = "$C$7";
  set("A13", "Entry Debt ($M)");             set("C13", "=C4*C6"); // Entry EBIT x Entry Debt/EBIT
  const entryDebtCell = "$C$13";

  // Period headers.
  for (let i = 0; i < nCols; i++) set(`${colLetter(firstDataCol + i)}15`, `Year ${i + 1}`);

  // ─── P&L / FCF bridge ────────────────────────────────────────────────
  let row = 15;
  const rEbit = ++row; set(`A${row}`, "EBIT");
  const rInterest = ++row; set(`A${row}`, "Interest Expense");
  const rEbt = ++row; set(`A${row}`, "Pre-Tax Income");
  const rTax = ++row; set(`A${row}`, "Tax");
  const rNopat = ++row; set(`A${row}`, "Net Income");
  const rDa = ++row; set(`A${row}`, "+ D&A");
  const rCapex = ++row; set(`A${row}`, "- CapEx");
  const rFcf = ++row; set(`A${row}`, "Cash Available for Debt Paydown");

  // The Debt Schedule's rows come immediately after -- its interest-expense
  // row is what rInterest above references, closing the circular loop
  // (EBIT -> Interest -> Pre-Tax -> Net Income -> FCF -> [debt schedule]
  // Sweep -> Ending Balance -> Average Balance -> Interest).
  const debtScheduleStartRow = row + 2;
  const debt = buildDebtSchedule({
    startRow: debtScheduleStartRow,
    axis,
    beginningBalanceCell: entryDebtCell,
    interestRateCell,
    cashAvailableForSweepRow: rFcf,
    mandatoryAmortizationPct: mandatoryAmortPct,
  });

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    set(`${col}${rEbit}`, i === 0 ? `=C4*(1+${ebitGrowthCell}/100)` : `=${prevCol}${rEbit}*(1+${ebitGrowthCell}/100)`);
    set(`${col}${rInterest}`, `=${col}${debt.interestExpenseRow}`);
    set(`${col}${rEbt}`, `=${col}${rEbit}-${col}${rInterest}`);
    set(`${col}${rTax}`, `=MAX(${col}${rEbt},0)*${taxCell}/100`);
    set(`${col}${rNopat}`, `=${col}${rEbt}-${col}${rTax}`);
    set(`${col}${rDa}`, `=${col}${rEbit}*${daCell}/100`);
    set(`${col}${rCapex}`, `=-${col}${rEbit}*${capexCell}/100`);
    set(`${col}${rFcf}`, `=${col}${rNopat}+${col}${rDa}+${col}${rCapex}`);
  }
  Object.assign(cells, debt.cells);

  // ─── Summary: leverage trajectory, the whole point of the model ──────
  let summaryRow = debt.endRow + 2;
  set(`A${summaryRow}`, "SUMMARY");
  const rLeverage = ++summaryRow; set(`A${summaryRow}`, "Debt / EBIT (x)");
  const rPaydownPct = ++summaryRow; set(`A${summaryRow}`, "Cumulative Paydown %");
  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    set(`${col}${rLeverage}`, `=${col}${debt.endingBalanceRow}/${col}${rEbit}`);
    set(`${col}${rPaydownPct}`, `=(1-${col}${debt.endingBalanceRow}/${entryDebtCell})*100`);
  }

  return cells;
}
