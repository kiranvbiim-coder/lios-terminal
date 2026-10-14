/**
 * Financial Schedule Builder -- composable schedule generators that plug
 * into any spreadsheet template's grid, instead of every template
 * hand-writing the same debt/working-capital/depreciation logic from
 * scratch. This is the prerequisite that makes a real template library (the
 * ~50 named methodologies in the roadmap gap analysis) achievable without
 * rewriting the same schedule 50 times -- a generator takes a starting row
 * and a period-column layout and returns a cell-map fragment plus the row
 * references its caller needs to link into (e.g. "here's the row holding
 * Interest Expense, wire it into your income statement").
 */

export interface PeriodAxis {
  firstDataCol: number; // 0-based column index of period 1 (e.g. 2 for column C)
  nHistCols: number;    // periods that are historical/literal
  nProjCols: number;    // periods that are formula-driven projections
}

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export interface DebtScheduleInputs {
  startRow: number;                  // 1-based row for the schedule's title
  axis: PeriodAxis;
  beginningBalanceCell: string;      // ref to period-0 beginning debt (e.g. a balance-sheet cell, or a literal-holding cell)
  interestRateCell: string;          // ref to the interest-rate assumption
  cashAvailableForSweepRow: number;  // row (same column layout) holding cash available for paydown each period, e.g. Free Cash Flow before financing
  mandatoryAmortizationPct: number;  // % of ORIGINAL principal amortized per period (0 for bullet/cov-lite structures)
}

export interface DebtScheduleResult {
  cells: Record<string, string>;
  endRow: number;              // last row this schedule used -- so the caller knows where to place whatever comes next
  beginningBalanceRow: number;
  endingBalanceRow: number;    // for the balance sheet (or another schedule) to reference
  interestExpenseRow: number;  // for the income statement to reference
}

/**
 * A single-tranche debt schedule with the textbook circular interest
 * calculation: interest is charged on the AVERAGE of the beginning and
 * ending balance, the ending balance depends on the cash sweep, the sweep
 * depends on cash-available-after-interest, and interest depends on the
 * average balance -- which depends on the ending balance. That's the same
 * five-row circular block (Beginning / Mandatory Amort / Optional Sweep /
 * Interest / Ending) every bank's LBO template uses (see Rosenbaum &
 * Pearl, and the debt-schedule research from earlier this session).
 *
 * Requires the grid's iterative-calculation mode to be enabled
 * (SpreadsheetGrid.setIterativeMode(true)) -- without it, this schedule's
 * cells will correctly show #CIRCULAR!, by design: this engine treats
 * circularity as an explicit opt-in per model, not a silent default.
 */
export function buildDebtSchedule(inputs: DebtScheduleInputs): DebtScheduleResult {
  const { startRow, axis, beginningBalanceCell, interestRateCell, cashAvailableForSweepRow, mandatoryAmortizationPct } = inputs;
  const { firstDataCol, nHistCols, nProjCols } = axis;
  const nCols = nHistCols + nProjCols;

  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  let row = startRow;
  set(`A${row}`, "DEBT SCHEDULE");
  const rBeginning = ++row; set(`A${row}`, "Beginning Balance");
  const rMandatory = ++row; set(`A${row}`, "- Mandatory Amortization");
  const rSweep = ++row; set(`A${row}`, "- Optional Cash Sweep");
  const rEnding = ++row; set(`A${row}`, "Ending Balance");
  const rAvg = ++row; set(`A${row}`, "Average Balance");
  const rInterest = ++row; set(`A${row}`, "Interest Expense");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    const cashCell = `${col}${cashAvailableForSweepRow}`;

    set(`${col}${rBeginning}`, i === 0 ? `=${beginningBalanceCell}` : `=${prevCol}${rEnding}`);
    // Mandatory amortization is a % of the ORIGINAL principal, standard
    // convention (not a % of the current balance) -- capped so it can never
    // amortize more than what's actually left outstanding.
    set(`${col}${rMandatory}`, mandatoryAmortizationPct > 0
      ? `=MIN(${col}${rBeginning},${beginningBalanceCell}*${mandatoryAmortizationPct}/100)`
      : "0");
    // Optional sweep: whatever cash remains after covering interest and
    // mandatory amortization, capped so the sweep can't overpay the
    // remaining balance or go negative if cash is short.
    set(`${col}${rSweep}`, `=MIN(MAX(${cashCell}-${col}${rInterest}-${col}${rMandatory},0),${col}${rBeginning}-${col}${rMandatory})`);
    set(`${col}${rEnding}`, `=${col}${rBeginning}-${col}${rMandatory}-${col}${rSweep}`);
    set(`${col}${rAvg}`, `=(${col}${rBeginning}+${col}${rEnding})/2`);
    set(`${col}${rInterest}`, `=${col}${rAvg}*${interestRateCell}/100`);
  }

  return { cells, endRow: rInterest, beginningBalanceRow: rBeginning, endingBalanceRow: rEnding, interestExpenseRow: rInterest };
}

export interface WorkingCapitalScheduleInputs {
  startRow: number;
  axis: PeriodAxis;
  revenueRow: number;        // same column layout, row holding Revenue
  cogsRow: number;           // row holding Cost of Revenue/COGS
  dsoCell: string;           // Days Sales Outstanding assumption ref
  dioCell: string;           // Days Inventory Outstanding assumption ref
  dpoCell: string;           // Days Payable Outstanding assumption ref
}

export interface WorkingCapitalScheduleResult {
  cells: Record<string, string>;
  endRow: number;
  accountsReceivableRow: number;
  inventoryRow: number;
  accountsPayableRow: number;
  changeInNwcRow: number; // for the cash flow statement to reference (a cash OUTFLOW when NWC grows)
}

/**
 * The DSO/DPO/DIO driver-based working-capital schedule -- the standard
 * upgrade over "hold last historical ratio flat" (roadmap item #12): each
 * balance is driven by an explicit days-outstanding assumption instead of
 * an implicit ratio baked in from one historical year, which is both more
 * transparent (the assumption is a real, editable number) and more
 * standard practice for a driver-based forecast.
 */
export function buildWorkingCapitalSchedule(inputs: WorkingCapitalScheduleInputs): WorkingCapitalScheduleResult {
  const { startRow, axis, revenueRow, cogsRow, dsoCell, dioCell, dpoCell } = inputs;
  const { firstDataCol, nHistCols, nProjCols } = axis;
  const nCols = nHistCols + nProjCols;

  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  let row = startRow;
  set(`A${row}`, "WORKING CAPITAL SCHEDULE (DSO/DIO/DPO)");
  const rAr = ++row; set(`A${row}`, "Accounts Receivable");
  const rInv = ++row; set(`A${row}`, "Inventory");
  const rAp = ++row; set(`A${row}`, "Accounts Payable");
  const rNwc = ++row; set(`A${row}`, "Net Working Capital");
  const rChange = ++row; set(`A${row}`, "Change in NWC");

  for (let i = 0; i < nCols; i++) {
    const col = colLetter(firstDataCol + i);
    const prevCol = colLetter(firstDataCol + i - 1);
    const revCell = `${col}${revenueRow}`;
    const cogsCell = `${col}${cogsRow}`;

    set(`${col}${rAr}`, `=${revCell}/365*${dsoCell}`);
    set(`${col}${rInv}`, `=${cogsCell}/365*${dioCell}`);
    set(`${col}${rAp}`, `=${cogsCell}/365*${dpoCell}`);
    set(`${col}${rNwc}`, `=${col}${rAr}+${col}${rInv}-${col}${rAp}`);
    // First period has no prior NWC to diff against -- the change is 0 (no
    // history to compare into from outside this schedule's own columns).
    set(`${col}${rChange}`, i === 0 ? "0" : `=${col}${rNwc}-${prevCol}${rNwc}`);
  }

  return { cells, endRow: rChange, accountsReceivableRow: rAr, inventoryRow: rInv, accountsPayableRow: rAp, changeInNwcRow: rChange };
}
