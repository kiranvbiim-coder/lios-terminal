/**
 * SimFin-based financial statements -- a third resilience layer alongside
 * SEC EDGAR and Finnhub (financialDataProviders.ts's PROVIDERS array tries
 * each in order, first non-empty result wins). Confirmed live before
 * building this: SimFin's real v3 API (https://backend.simfin.com/api/v3/
 * companies/statements/compact) returns genuine filed income statement,
 * balance sheet, and cash flow data with broad global-company coverage
 * (not just US, unlike Finnhub's free tier) -- tested against real AAPL
 * data, confirmed FY2024 revenue $391.035B matches the real 10-K.
 *
 * Free tier: 2 calls/second (SimFin's documented rate limit), which is why
 * getReports fetches all three statement types isn't attempted here --
 * callers ask for one report_type at a time, same as every other provider.
 */
import { getCredential } from "./terminalConfig";
import type { LseFinancialReport } from "./lseData";
import { recordConnectorVerification } from "./connectorVerification";
import { upsertCompany, persistFinancialStatementPeriods } from "./companyStore";

const SIMFIN_BASE = "https://backend.simfin.com/api/v3";

function resolveApiKey(): string | null {
  return getCredential("SIMFIN_API_KEY", "simfinApiKey");
}

// Maps this app's canonical field names (same names secEdgarFinancials.ts's
// INCOME_FIELDS/BALANCE_FIELDS/CASHFLOW_FIELDS use) to SimFin's real column
// labels, confirmed against a live /companies/statements/compact response
// for AAPL (see module docstring).
const INCOME_MAP: Record<string, string> = {
  revenue: "Revenue",
  costOfRevenue: "Cost of revenue",
  grossProfit: "Gross Profit",
  researchAndDevelopmentExpenses: "Research & Development",
  sellingGeneralAndAdministrativeExpenses: "Selling, General & Administrative",
  operatingExpenses: "Operating Expenses",
  operatingIncome: "Operating Income (Loss)",
  interestExpense: "Interest Expense",
  interestIncome: "Interest Income",
  totalOtherIncomeExpensesNet: "Non-Operating Income (Loss)",
  incomeBeforeTax: "Pretax Income (Loss)",
  incomeTaxExpense: "Income Tax (Expense) Benefit, net",
  netIncome: "Net Income",
  depreciationAndAmortization: "Depreciation & Amortization",
};

const BALANCE_MAP: Record<string, string> = {
  cashAndCashEquivalents: "Cash & Cash Equivalents",
  shortTermInvestments: "Short Term Investments",
  netReceivables: "Accounts Receivable, Net",
  inventory: "Inventories",
  totalCurrentAssets: "Total Current Assets",
  propertyPlantEquipmentNet: "Property, Plant & Equipment, Net",
  goodwill: "Goodwill",
  intangibleAssets: "Other Intangible Assets",
  longTermInvestments: "Long Term Investments",
  totalNonCurrentAssets: "Total Noncurrent Assets",
  totalAssets: "Total Assets",
  accountPayables: "Accounts Payable",
  shortTermDebt: "Short Term Debt",
  deferredRevenue: "Deferred Revenue (Short Term)",
  totalCurrentLiabilities: "Total Current Liabilities",
  longTermDebt: "Long Term Debt",
  totalNonCurrentLiabilities: "Total Noncurrent Liabilities",
  totalLiabilities: "Total Liabilities",
  commonStock: "Common Stock",
  additionalPaidInCapital: "Additional Paid in Capital",
  retainedEarnings: "Retained Earnings",
  treasuryStock: "Treasury Stock",
  totalStockholdersEquity: "Total Equity",
  totalLiabilitiesAndTotalEquity: "Total Liabilities & Equity",
};

export const CASHFLOW_MAP: Record<string, string> = {
  netIncome: "Net Income",
  depreciationAndAmortization: "Depreciation & Amortization",
  stockBasedCompensation: "Stock-Based Compensation",
  deferredIncomeTax: "Deferred Income Taxes",
  accountsReceivables: "(Increase) Decrease in Accounts Receivable",
  inventory: "(Increase) Decrease in Inventories",
  accountsPayables: "Increase (Decrease) in Accounts Payable",
  netCashProvidedByOperatingActivities: "Cash from Operating Activities",
  investmentsInPropertyPlantAndEquipment: "Purchase of Fixed Assets",
  netCashProvidedByInvestingActivities: "Cash from Investing Activities",
  commonDividendsPaid: "Dividends Paid",
  netCashProvidedByFinancingActivities: "Cash from Financing Activities",
  effectOfForexChangesOnCash: "Effect of Foreign Exchange Rates",
  netChangeInCash: "Net Changes in Cash",
};

const REPORT_TYPE_MAP: Record<string, { statement: "PL" | "BS" | "CF"; fieldMap: Record<string, string> }> = {
  income: { statement: "PL", fieldMap: INCOME_MAP },
  balance: { statement: "BS", fieldMap: BALANCE_MAP },
  cashflow: { statement: "CF", fieldMap: CASHFLOW_MAP },
};

interface SimFinStatementResponse {
  ticker: string;
  currency: string;
  statements: Array<{
    statement: string;
    columns: string[];
    data: Array<Array<string | number | null>>;
  }>;
}

export async function getSimFinFinancialReports(symbol: string, reportType = "income", period = "FY"): Promise<LseFinancialReport[]> {
  const apiKey = resolveApiKey();
  const mapping = REPORT_TYPE_MAP[reportType];
  if (!apiKey || !mapping) return [];

  try {
    const url = `${SIMFIN_BASE}/companies/statements/compact?ticker=${encodeURIComponent(symbol)}&statements=${mapping.statement}&period=${encodeURIComponent(period)}`;
    const res = await fetch(url, { headers: { Authorization: `api-key ${apiKey}` } });
    if (!res.ok) {
      recordConnectorVerification("simfin", false, `SimFin request returned ${res.status}.`);
      return [];
    }

    const body = (await res.json()) as SimFinStatementResponse[] | { error?: string };
    if (!Array.isArray(body) || body.length === 0) {
      recordConnectorVerification("simfin", false, "SimFin returned an empty payload.");
      return [];
    }
    recordConnectorVerification("simfin", true, "SimFin responded to a live request.");

    const company = body[0];
    const statement = company.statements.find((s) => s.statement === mapping.statement);
    if (!statement || statement.data.length === 0) return [];

    const columnIndex = new Map(statement.columns.map((col, i) => [col, i]));
    const fyIdx = columnIndex.get("Fiscal Year");
    const reportDateIdx = columnIndex.get("Report Date");
    const publishDateIdx = columnIndex.get("Publish Date");

    const reports: LseFinancialReport[] = [];
    const persistableRows: Array<{ reportType: string; periodEnd: string; fiscalYear: string; period: string; reportedCurrency: string; data: Record<string, number>; filingDate: string | null }> = [];
    for (const row of statement.data) {
      const record: Record<string, number> = {};
      for (const [field, simfinColumn] of Object.entries(mapping.fieldMap)) {
        const idx = columnIndex.get(simfinColumn);
        if (idx === undefined) continue;
        const value = row[idx];
        if (typeof value === "number") record[field] = value;
      }
      if (Object.keys(record).length === 0) continue;

      const fiscalYear = fyIdx !== undefined ? String(row[fyIdx]) : "";
      const reportDate = reportDateIdx !== undefined ? String(row[reportDateIdx]) : "";
      const publishDate = publishDateIdx !== undefined ? String(row[publishDateIdx]) : null;

      reports.push({
        symbol: symbol.toUpperCase(),
        report_type: reportType,
        date: reportDate,
        fiscal_year: fiscalYear,
        period,
        reported_currency: company.currency || "USD",
        data: JSON.stringify(record),
        filing_date: publishDate,
      });
      persistableRows.push({
        reportType,
        periodEnd: reportDate,
        fiscalYear,
        period,
        reportedCurrency: company.currency || "USD",
        data: record,
        filingDate: publishDate,
      });
    }

    if (persistableRows.length > 0) {
      // Parity with every other financial-statement provider
      // (secEdgarFinancials.ts, finnhubFinancials.ts, bseIndia.ts,
      // screenerIndia.ts, xbrlFilingsOrg.ts, yfinanceFinancials.ts): a
      // successful SimFin fetch also writes through to the canonical
      // companies/company_identifiers tables. Previously this provider was
      // the only one in the waterfall that never did, so a SimFin-only
      // symbol was invisible to resolveEntity()/company lookups.
      try {
        const companyId = await upsertCompany({ symbol: symbol.toUpperCase(), currency: company.currency || undefined, source: "simfin" });
        await persistFinancialStatementPeriods(
          companyId,
          persistableRows.map((r) => ({ ...r, source: "simfin" })),
        );
      } catch (err) {
        console.warn(`Failed to persist SimFin financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    return reports;
  } catch (err) {
    recordConnectorVerification("simfin", false, err instanceof Error ? err.message : String(err));
    return [];
  }
}
