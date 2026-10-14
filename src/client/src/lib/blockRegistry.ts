/**
 * Reusable Model Blocks -- turns the Financial Schedule Builder generators
 * (scheduleBuilders.ts) into something a user can drop into ANY open model
 * at their own cursor, not just something baked into a handful of full
 * templates. A block definition wraps one schedule generator with a small
 * form spec (what inputs it needs -- a cell reference, a row number, a
 * period count) and an insertion point (the row/column the user is
 * currently sitting on), and hands back the exact same cell-map shape the
 * template registry already knows how to merge into a grid -- no new
 * insertion mechanism needed, just a new entry point into the one that
 * already exists for templates.
 */
import { buildDebtSchedule, buildWorkingCapitalSchedule, type PeriodAxis } from "./scheduleBuilders";

export interface BlockFieldSpec {
  key: string;
  label: string;
  default?: string;
}

export interface BlockInsertContext {
  startRow: number;     // 1-based row where the block's title goes
  firstDataCol: number; // 0-based column index of period 1
}

export interface BlockBuildResult {
  cells: Record<string, string>;
  endRow: number;
  summary: string;
}

export interface BlockDefinition {
  id: string;
  label: string;
  description: string;
  fields: BlockFieldSpec[];
  requiresIterativeCalc?: boolean;
  build: (values: Record<string, string>, ctx: BlockInsertContext) => BlockBuildResult;
}

function toNum(v: string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const BLOCK_REGISTRY: BlockDefinition[] = [
  {
    id: "debt-schedule",
    label: "Debt Schedule",
    description: "Beginning / Mandatory Amort / Optional Sweep / Ending / Average / Interest -- the standard circular LBO-style debt paydown block. Requires iterative calculation (auto-enabled on insert).",
    requiresIterativeCalc: true,
    fields: [
      { key: "periods", label: "Number of periods", default: "5" },
      { key: "beginningBalanceCell", label: "Beginning balance cell (e.g. $C$8)" },
      { key: "interestRateCell", label: "Interest rate cell (e.g. $C$9)" },
      { key: "cashAvailableRow", label: "Row holding cash available for sweep" },
      { key: "mandatoryAmortPct", label: "Mandatory amortization % of original principal", default: "0" },
    ],
    build: (values, ctx) => {
      const axis: PeriodAxis = { firstDataCol: ctx.firstDataCol, nHistCols: 0, nProjCols: Math.max(1, Math.trunc(toNum(values.periods, 5))) };
      const result = buildDebtSchedule({
        startRow: ctx.startRow,
        axis,
        beginningBalanceCell: (values.beginningBalanceCell ?? "").trim(),
        interestRateCell: (values.interestRateCell ?? "").trim(),
        cashAvailableForSweepRow: Math.trunc(toNum(values.cashAvailableRow)),
        mandatoryAmortizationPct: toNum(values.mandatoryAmortPct, 0),
      });
      return {
        cells: result.cells,
        endRow: result.endRow,
        summary: `Ending Balance -> row ${result.endingBalanceRow}, Interest Expense -> row ${result.interestExpenseRow}`,
      };
    },
  },
  {
    id: "working-capital-schedule",
    label: "Working Capital Schedule (DSO/DIO/DPO)",
    description: "Accounts Receivable / Inventory / Accounts Payable / Net Working Capital / Change in NWC, driven by days-outstanding assumptions instead of a flat historical ratio.",
    fields: [
      { key: "periods", label: "Number of periods", default: "5" },
      { key: "revenueRow", label: "Row holding Revenue" },
      { key: "cogsRow", label: "Row holding COGS" },
      { key: "dsoCell", label: "DSO assumption cell (e.g. $C$10)" },
      { key: "dioCell", label: "DIO assumption cell (e.g. $C$11)" },
      { key: "dpoCell", label: "DPO assumption cell (e.g. $C$12)" },
    ],
    build: (values, ctx) => {
      const axis: PeriodAxis = { firstDataCol: ctx.firstDataCol, nHistCols: 0, nProjCols: Math.max(1, Math.trunc(toNum(values.periods, 5))) };
      const result = buildWorkingCapitalSchedule({
        startRow: ctx.startRow,
        axis,
        revenueRow: Math.trunc(toNum(values.revenueRow)),
        cogsRow: Math.trunc(toNum(values.cogsRow)),
        dsoCell: (values.dsoCell ?? "").trim(),
        dioCell: (values.dioCell ?? "").trim(),
        dpoCell: (values.dpoCell ?? "").trim(),
      });
      return {
        cells: result.cells,
        endRow: result.endRow,
        summary: `Change in NWC -> row ${result.changeInNwcRow}`,
      };
    },
  },
];

export function getBlock(id: string): BlockDefinition | undefined {
  return BLOCK_REGISTRY.find((b) => b.id === id);
}
