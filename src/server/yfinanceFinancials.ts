/**
 * yfinance-based financial statements -- the broadest fallback in the
 * provider waterfall (see financialDataProviders.ts), for symbols none of
 * LSE/SEC EDGAR/Screener.in/BSE India/XBRL Filings.org have anything for.
 * financialDataProviders.ts's own top comment named China A-shares
 * (SSE/SZSE) and Brazil (B3) as known permanent gaps -- confirmed live
 * before building this: LSE returns 0 reports for 002206.SZ and
 * 600455.SS (real Shenzhen/Shanghai A-shares), but yfinance has complete,
 * real statement data for the same symbols (51 real line items across 4
 * fiscal years for 002206.SZ, independently confirmed via yf.Ticker(...)
 * .financials/.balance_sheet/.cashflow). Registered last in PROVIDERS
 * (broadest net, only tried when every more specific/authoritative source
 * has nothing).
 *
 * Field mapping below follows the exact same shape secEdgarFinancials.ts
 * already uses (INCOME_FIELDS/BALANCE_FIELDS/CASHFLOW_FIELDS keyed by the
 * same target field names FullIncomeData/FullBalanceSheetData/
 * FullCashflowData expect), just sourced from yfinance's own row names
 * instead of XBRL tags. Same discipline as that provider states for its
 * own tags: every mapping here needs live cross-checking against a
 * known-good company (e.g. AAPL) against an independent filing before the
 * mapped values are treated as verified; provider row names alone are not
 * sufficient evidence of field-level correctness.
 *
 * Annual (period="FY") only for now -- yfinance's quarterly statements
 * have the same "which quarter is really standalone vs. YTD cumulative"
 * ambiguity secEdgarFinancials.ts's own Q4 comment describes; period !==
 * "FY" honestly falls back to whatever's already persisted rather than a
 * guessed number, same pattern that provider already uses.
 */
import { runCommand } from "./exec/run-command";
import path from "path";
import type { LseFinancialReport } from "./lseData";
import { upsertCompany, persistFinancialStatementPeriods, getFinancialStatementPeriodsForSymbol } from "./companyStore";
import { resolveCommunityPythonExecutable } from "./communityPythonRuntime";
import { isMarketDataProviderAuthorized, resolveMarketDataScope } from "./marketDataScope";

type FieldMap = Record<string, { rows: string[]; negate?: boolean }>;
/**
 * Typed registry for the stable numeric fields exposed by yfinance's
 * `Ticker.info` object. Unknown provider keys are intentionally kept in
 * `rawExtended` by extractYfinanceFundamentals rather than promoted to
 * canonical values.
 */
export interface YfinanceFundamentalField {
  key: string;
  label: string;
  unit: "currency" | "per_share" | "multiple" | "ratio" | "percent" | "count";
  sourceKeys: readonly string[];
}

export const YFINANCE_FUNDAMENTAL_FIELD_REGISTRY: readonly YfinanceFundamentalField[] = [
  { key: "enterpriseValue", label: "Enterprise Value", unit: "currency", sourceKeys: ["enterpriseValue"] },
  { key: "enterpriseToRevenue", label: "Enterprise Value / Revenue", unit: "multiple", sourceKeys: ["enterpriseToRevenue"] },
  { key: "enterpriseToEbitda", label: "Enterprise Value / EBITDA", unit: "multiple", sourceKeys: ["enterpriseToEbitda"] },
  { key: "enterpriseToEbit", label: "Enterprise Value / EBIT", unit: "multiple", sourceKeys: ["enterpriseToEbit"] },
  { key: "trailingPE", label: "Trailing P/E", unit: "multiple", sourceKeys: ["trailingPE"] },
  { key: "forwardPE", label: "Forward P/E", unit: "multiple", sourceKeys: ["forwardPE"] },
  { key: "priceToSalesTrailing12Months", label: "Price / Sales", unit: "multiple", sourceKeys: ["priceToSalesTrailing12Months"] },
  { key: "priceToBook", label: "Price / Book", unit: "multiple", sourceKeys: ["priceToBook"] },
  { key: "currentRatio", label: "Current Ratio", unit: "ratio", sourceKeys: ["currentRatio"] },
  { key: "quickRatio", label: "Quick Ratio", unit: "ratio", sourceKeys: ["quickRatio"] },
  { key: "totalCash", label: "Total Cash", unit: "currency", sourceKeys: ["totalCash"] },
  { key: "totalCashPerShare", label: "Cash / Share", unit: "per_share", sourceKeys: ["totalCashPerShare"] },
  { key: "totalDebt", label: "Total Debt", unit: "currency", sourceKeys: ["totalDebt"] },
  { key: "debtToEquity", label: "Debt / Equity", unit: "ratio", sourceKeys: ["debtToEquity"] },
  { key: "freeCashflow", label: "Free Cash Flow", unit: "currency", sourceKeys: ["freeCashflow"] },
  { key: "operatingCashflow", label: "Operating Cash Flow", unit: "currency", sourceKeys: ["operatingCashflow"] },
  { key: "grossMargins", label: "Gross Margin", unit: "percent", sourceKeys: ["grossMargins"] },
  { key: "operatingMargins", label: "Operating Margin", unit: "percent", sourceKeys: ["operatingMargins"] },
  { key: "profitMargins", label: "Profit Margin", unit: "percent", sourceKeys: ["profitMargins"] },
  { key: "returnOnAssets", label: "Return on Assets", unit: "percent", sourceKeys: ["returnOnAssets"] },
  { key: "returnOnEquity", label: "Return on Equity", unit: "percent", sourceKeys: ["returnOnEquity"] },
  { key: "targetHighPrice", label: "Analyst Target High", unit: "per_share", sourceKeys: ["targetHighPrice"] },
  { key: "targetLowPrice", label: "Analyst Target Low", unit: "per_share", sourceKeys: ["targetLowPrice"] },
  { key: "targetMeanPrice", label: "Analyst Target Mean", unit: "per_share", sourceKeys: ["targetMeanPrice"] },
  { key: "targetMedianPrice", label: "Analyst Target Median", unit: "per_share", sourceKeys: ["targetMedianPrice"] },
  { key: "numberOfAnalystOpinions", label: "Analyst Opinion Count", unit: "count", sourceKeys: ["numberOfAnalystOpinions"] },
  { key: "dividendRate", label: "Dividend Rate", unit: "per_share", sourceKeys: ["dividendRate"] },
  { key: "dividendYield", label: "Dividend Yield", unit: "percent", sourceKeys: ["dividendYield"] },
  { key: "fiveYearAvgDividendYield", label: "Five-Year Average Dividend Yield", unit: "percent", sourceKeys: ["fiveYearAvgDividendYield"] },
  { key: "payoutRatio", label: "Payout Ratio", unit: "percent", sourceKeys: ["payoutRatio"] },
  { key: "earningsGrowth", label: "Earnings Growth", unit: "percent", sourceKeys: ["earningsGrowth"] },
  { key: "revenueGrowth", label: "Revenue Growth", unit: "percent", sourceKeys: ["revenueGrowth"] },
  { key: "earningsQuarterlyGrowth", label: "Quarterly Earnings Growth", unit: "percent", sourceKeys: ["earningsQuarterlyGrowth"] },
  { key: "revenuePerShare", label: "Revenue / Share", unit: "per_share", sourceKeys: ["revenuePerShare"] },
];

export interface YfinanceFundamentalsSnapshot {
  fields: Record<string, number | null>;
  rawExtended: Record<string, unknown>;
  source: { provider: "yfinance"; sourceReference: string; retrievedAt: string | null };
}

export function extractYfinanceFundamentals(
  source: Record<string, unknown>,
  metadata: { retrievedAt?: string | null; sourceReference?: string } = {},
): YfinanceFundamentalsSnapshot {
  const fields: Record<string, number | null> = {};
  const knownKeys = new Set<string>();
  for (const field of YFINANCE_FUNDAMENTAL_FIELD_REGISTRY) {
    for (const sourceKey of field.sourceKeys) knownKeys.add(sourceKey);
    const value = field.sourceKeys.map((key) => source[key]).find((value) => typeof value === "number" && Number.isFinite(value));
    fields[field.key] = typeof value === "number" ? value : null;
  }
  const rawExtended = Object.fromEntries(Object.entries(source).filter(([key]) => !knownKeys.has(key)));
  return {
    fields,
    rawExtended,
    source: { provider: "yfinance", sourceReference: metadata.sourceReference ?? "yfinance:Ticker.info", retrievedAt: metadata.retrievedAt ?? null },
  };
}

// Each target field lists every real yfinance row name that could supply
// it (some companies/report styles use different row names for the same
// concept) -- first match wins.
export const INCOME_FIELDS: FieldMap = {
  revenue: { rows: ["Total Revenue", "Operating Revenue"] },
  costOfRevenue: { rows: ["Cost Of Revenue", "Reconciled Cost Of Revenue"] },
  grossProfit: { rows: ["Gross Profit"] },
  researchAndDevelopmentExpenses: { rows: ["Research And Development", "Research & Development"] },
  sellingGeneralAndAdministrativeExpenses: { rows: ["Selling General And Administrative", "SG&A Expense"] },
  operatingExpenses: { rows: ["Operating Expense", "Operating Expenses", "Total Expenses"] },
  otherOperatingIncome: { rows: ["Other Operating Income Expense", "Other Non Operating Income Expenses"] },
  operatingIncome: { rows: ["Operating Income"] },
  ebit: { rows: ["EBIT"] },
  interestExpense: { rows: ["Interest Expense", "Interest Expense Non Operating"] },
  interestIncome: { rows: ["Interest Income Non Operating", "Interest Income"] },
  totalOtherIncomeExpensesNet: { rows: ["Other Non Operating Income Expenses"] },
  incomeBeforeTax: { rows: ["Pretax Income"] },
  incomeTaxExpense: { rows: ["Tax Provision"] },
  netIncome: { rows: ["Net Income", "Net Income Common Stockholders", "Net Income Including Noncontrolling Interests"] },
  eps: { rows: ["Basic EPS"] },
  epsDiluted: { rows: ["Diluted EPS"] },
  depreciationAndAmortization: { rows: ["Reconciled Depreciation", "Depreciation And Amortization In Income Statement"] },
};

export const BALANCE_FIELDS: FieldMap = {
  cashAndCashEquivalents: { rows: ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"] },
  shortTermInvestments: { rows: ["Other Short Term Investments", "Short Term Investments"] },
  netReceivables: { rows: ["Receivables", "Accounts Receivable"] },
  inventory: { rows: ["Inventory"] },
  otherCurrentAssets: { rows: ["Other Current Assets"] },
  totalCurrentAssets: { rows: ["Current Assets"] },
  propertyPlantEquipmentNet: { rows: ["Net PPE"] },
  goodwill: { rows: ["Goodwill"] },
  intangibleAssets: { rows: ["Other Intangible Assets", "Goodwill And Other Intangible Assets"] },
  totalNonCurrentAssets: { rows: ["Total Non Current Assets", "Total Non-Current Assets"] },
  totalAssets: { rows: ["Total Assets"] },
  accountPayables: { rows: ["Accounts Payable", "Payables And Accrued Expenses"] },
  shortTermDebt: { rows: ["Current Debt", "Current Debt And Capital Lease Obligation"] },
  deferredRevenue: { rows: ["Current Deferred Revenue"] },
  totalCurrentLiabilities: { rows: ["Current Liabilities"] },
  longTermDebt: { rows: ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"] },
  totalNonCurrentLiabilities: { rows: ["Total Non Current Liabilities Net Minority Interest", "Total Non-Current Liabilities"] },
  totalLiabilities: { rows: ["Total Liabilities Net Minority Interest", "Total Liabilities"] },
  retainedEarnings: { rows: ["Retained Earnings"] },
  totalStockholdersEquity: { rows: ["Stockholders Equity", "Common Stock Equity"] },
};

export const CASHFLOW_FIELDS: FieldMap = {
  netIncome: { rows: ["Net Income From Continuing Operations", "Net Income"] },
  depreciationAndAmortization: { rows: ["Depreciation And Amortization", "Depreciation"] },
  stockBasedCompensation: { rows: ["Stock Based Compensation"] },
  otherWorkingCapital: { rows: ["Change In Working Capital"] },
  netCashProvidedByOperatingActivities: { rows: ["Operating Cash Flow"] },
  investmentsInPropertyPlantAndEquipment: { rows: ["Capital Expenditure"] },
  netCashProvidedByInvestingActivities: { rows: ["Investing Cash Flow"] },
  netDebtIssuance: { rows: ["Net Issuance Payments Of Debt"] },
  commonStockIssuance: { rows: ["Issuance Of Capital Stock", "Common Stock Issuance"] },
  commonStockRepurchased: { rows: ["Repurchase Of Capital Stock", "Common Stock Payments"], negate: true },
  netCashProvidedByFinancingActivities: { rows: ["Financing Cash Flow"] },
  effectOfForexChangesOnCash: { rows: ["Effect Of Exchange Rate Changes"] },
  netChangeInCash: { rows: ["Changes In Cash"] },
  cashAtBeginningOfPeriod: { rows: ["Beginning Cash Position"] },
  cashAtEndOfPeriod: { rows: ["End Cash Position"] },
  operatingCashFlow: { rows: ["Operating Cash Flow"] },
  capitalExpenditure: { rows: ["Capital Expenditure"] },
  freeCashFlow: { rows: ["Free Cash Flow"] },
  incomeTaxesPaid: { rows: ["Tax Payments"] },
  interestPaid: { rows: ["Interest Paid"] },
};



function pickRow(periodData: Record<string, number>, spec: { rows: string[]; negate?: boolean }): number | undefined {
  for (const rowName of spec.rows) {
    const v = periodData[rowName];
    if (v !== undefined) return spec.negate ? -Math.abs(v) : v;
  }
  return undefined;
}

function buildRow(fields: FieldMap, periodData: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const v = pickRow(periodData, spec);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function deriveAliasesAndTotals(reportType: string, row: Record<string, number>): void {
  if (reportType === "income" && row.ebit === undefined && row.operatingIncome !== undefined) {
    row.ebit = row.operatingIncome;
  }
  if (reportType === "cashflow") {
    if (row.commonStockIssuance !== undefined || row.commonStockRepurchased !== undefined) {
      row.netCommonStockIssuance = (row.commonStockIssuance ?? 0) + (row.commonStockRepurchased ?? 0);
    }
    // freeCashFlow direct from yfinance is preferred; derive only if missing.
    if (row.freeCashFlow === undefined && row.operatingCashFlow !== undefined && row.capitalExpenditure !== undefined) {
      row.freeCashFlow = row.operatingCashFlow + row.capitalExpenditure; // capex already negative from yfinance
    }
  }
}

interface YfFinancialsResult {
  symbol: string;
  reportType: string;
  periods: Record<string, Record<string, number>>;
}

async function downloadFinancialsWithPython(symbol: string, reportType: "income" | "balance" | "cashflow"): Promise<YfFinancialsResult> {
  const resourcesBase = ("resourcesPath" in process && typeof process.resourcesPath === "string" ? process.resourcesPath : undefined) || process.env.ELECTRON_RESOURCES_PATH;
  const scriptPath = resourcesBase
    ? path.join(resourcesBase, "script", "fetch_yfinance_financials.py")
    : path.resolve(process.cwd(), "script", "fetch_yfinance_financials.py");
  const python = resolveCommunityPythonExecutable();
  const { stdout } = await runCommand({
    argv: [python.executable, scriptPath, "--symbol", symbol, "--report-type", reportType],
    timeoutMs: 60_000,
    maxOutputChars: 1024 * 1024 * 10,
    env: {
      PYTHONDONTWRITEBYTECODE: "1",
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      all_proxy: process.env.all_proxy,
      no_proxy: process.env.no_proxy,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      SSL_CERT_DIR: process.env.SSL_CERT_DIR,
      REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
      CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE,
    },
  });
  const data = JSON.parse(stdout);
  if (data.error) throw new Error(data.error);
  return data as YfFinancialsResult;
}

async function financialReportsFromStore(symbol: string, reportType: string, period: string): Promise<LseFinancialReport[]> {
  const rows = await getFinancialStatementPeriodsForSymbol(symbol, reportType).catch(() => []);
  return rows
    .filter((r) => r.period === period && r.source === "yfinance")
    .map((r) => ({
      symbol: symbol.toUpperCase(),
      report_type: r.reportType,
      date: r.periodEnd,
      fiscal_year: r.fiscalYear,
      period: r.period,
      reported_currency: r.reportedCurrency,
      data: JSON.stringify(r.data),
      filing_date: r.filingDate,
    }));
}

const REPORT_TYPE_MAP: Record<string, "income" | "balance" | "cashflow"> = {
  income: "income",
  balance: "balance",
  cashflow: "cashflow",
};
export async function getYfinanceFinancialReports(symbol: string, reportType = "income", period = "FY"): Promise<LseFinancialReport[]> {
  if (!isMarketDataProviderAuthorized("yahoo_finance", resolveMarketDataScope())) return [];
  const ytype = REPORT_TYPE_MAP[reportType];
  if (!ytype || period !== "FY") return financialReportsFromStore(symbol, reportType, period);

  try {
    const result = await downloadFinancialsWithPython(symbol, ytype);
    const fieldMap = ytype === "balance" ? BALANCE_FIELDS : ytype === "cashflow" ? CASHFLOW_FIELDS : INCOME_FIELDS;

    const periodEnds = Object.keys(result.periods).sort().reverse().slice(0, 100);
    const rows: LseFinancialReport[] = [];
    for (const end of periodEnds) {
      const row = buildRow(fieldMap, result.periods[end]);
      if (Object.keys(row).length === 0) continue;
      deriveAliasesAndTotals(ytype, row);
      rows.push({
        symbol: symbol.toUpperCase(),
        report_type: reportType,
        date: end,
        fiscal_year: String(new Date(end).getFullYear()),
        period,
        reported_currency: "USD",
        data: JSON.stringify(row),
        filing_date: null,
      });
    }

    if (rows.length === 0) return financialReportsFromStore(symbol, reportType, period);

    try {
      const companyId = await upsertCompany({ symbol: symbol.toUpperCase() });
      await persistFinancialStatementPeriods(
        companyId,
        rows.map((r) => ({
          reportType: r.report_type,
          periodEnd: r.date,
          fiscalYear: r.fiscal_year,
          period: r.period,
          reportedCurrency: r.reported_currency,
          data: JSON.parse(r.data) as Record<string, number>,
          filingDate: r.filing_date,
          source: "yfinance",
        })),
      );
    } catch (err) {
      console.warn(`Failed to persist yfinance financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
    }

    return rows;
  } catch (err) {
    console.warn(`yfinance financials fetch failed for ${symbol}, falling back to persisted data:`, err instanceof Error ? err.message : err);
    return financialReportsFromStore(symbol, reportType, period);
  }
}
