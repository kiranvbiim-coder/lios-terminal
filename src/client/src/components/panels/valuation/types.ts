// Shared shapes for the "Corporate Valuation" desk's advanced-analysis tabs
// (Ratios, DDM, Beneish, Ohlson, Comps). Fields beyond what the original
// DCF/DuPont/Altman/Piotroski tabs used are drawn from the same LSE
// financial_reports line items FinancialStatementsPanel already renders --
// so no new data source, just a wider slice of the same JSON blob.

import type { LseFinancialReport } from "@/lib/useLse";

export interface FullBalanceSheetData {
  totalCurrentAssets: number; totalCurrentLiabilities: number; totalAssets: number;
  retainedEarnings: number; totalLiabilities: number; longTermDebt: number;
  cashAndCashEquivalents: number; netReceivables: number; inventory: number;
  propertyPlantEquipmentNet: number; totalStockholdersEquity: number; shortTermDebt: number;
  accountPayables: number;
}

export interface FullIncomeData {
  ebit: number; revenue: number; netIncome: number;
  costOfRevenue: number; grossProfit: number; operatingIncome: number;
  interestExpense: number; sellingGeneralAndAdministrativeExpenses: number;
  depreciationAndAmortization: number; incomeTaxExpense: number; incomeBeforeTax: number;
}

export interface FullCashflowData {
  operatingCashFlow: number; netCommonStockIssuance: number;
  capitalExpenditure: number; freeCashFlow: number;
}

export interface AnalysisTabProps {
  symbol: string;
  curr: string;
  price: number;
  eps: number | null;
  marketCap: number | null;
  balCurrent: FullBalanceSheetData | null;
  balPrior: FullBalanceSheetData | null;
  incCurrent: FullIncomeData | null;
  incPrior: FullIncomeData | null;
  cfCurrent: FullCashflowData | null;
  cfPrior: FullCashflowData | null;
  /** Full multi-year report history (most-recent-first), for tabs that need
   * more than the current+prior period -- e.g. RatiosTab's CAGR section.
   * Optional since most tabs only need the two-period shape above. */
  incomeReportsFull?: LseFinancialReport[];
  balanceReportsFull?: LseFinancialReport[];
}
