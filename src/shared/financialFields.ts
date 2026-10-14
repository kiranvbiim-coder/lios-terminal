/**
 * Canonical Financial Data Model -- one standardized schema for every
 * company, used by every producer and every consumer of statement data in
 * this app.
 *
 * Before this file, the same field keys/labels were hand-duplicated in at
 * least three places -- FinancialStatementsPanel.tsx (the UI's section
 * layout), pdfStatementExtractor.ts (label-matching for PDF import), and
 * xbrlFilingsOrg.ts (XBRL tag mapping) -- and they'd already drifted: the
 * PDF extractor returned "trade and other receivables" as a display label
 * for the same field the UI calls "Accounts Receivable". Every producer
 * (SEC EDGAR, LSE, Screener.in, BSE, XBRL Filings, manual PDF import) and
 * consumer (the statements viewer, the review grid) now reads field
 * key/label/grouping from here instead of keeping its own copy.
 *
 * A report row's `data` field (see financialDataProviders.ts) stays exactly
 * what it's always been -- a flat JSON object of canonicalKey -> number,
 * one row per (symbol, statement type, period), tagged with a single
 * whole-row `data_source`. Field-LEVEL provenance (so an import and a live
 * scrape that disagree on one line item could both be shown) is
 * deliberately NOT built here: no code path today merges two providers'
 * values into one row -- the waterfall picks exactly one winner per
 * request -- so field-level provenance would be speculative plumbing for a
 * conflict that can't currently occur. Worth revisiting if/when the
 * Financial Dataset Manager grows real cross-source merging.
 */

export type StatementType = "balance" | "income" | "cashflow";

export interface CanonicalLineItem {
  key: string;
  label: string;
  bold?: boolean;
  /**
   * Real-world label variants a filed statement might use for this line
   * item, lowercase, for text/label matching (PDF extraction, future
   * fuzzy-search import). UI rendering never reads this -- only matching
   * code (pdfStatementExtractor.ts) does. The canonical `label` itself is
   * always an implicit match candidate; callers don't need to repeat it
   * here.
   */
  synonyms?: string[];
}

export interface CanonicalSection {
  /** Empty string renders as a title-less divider row (e.g. a standalone TOTAL ASSETS line). */
  title: string;
  items: CanonicalLineItem[];
}

export const BALANCE_SECTIONS: CanonicalSection[] = [
  {
    title: "CURRENT ASSETS",
    items: [
      { key: "cashAndCashEquivalents", label: "Cash & Cash Equivalents", synonyms: ["cash and cash equivalents", "cash at bank", "cash and bank balances", "cash & cash equivalents"] },
      { key: "restrictedCash", label: "Restricted Cash", synonyms: ["restricted cash"] },
      { key: "shortTermInvestments", label: "Short-Term Investments", synonyms: ["short-term investments", "short term investments", "current investments"] },
      { key: "netReceivables", label: "Accounts Receivable", synonyms: ["trade and other receivables", "trade receivables", "accounts receivable", "debtors"] },
      { key: "inventory", label: "Inventory", synonyms: ["inventories", "inventory", "stock"] },
      { key: "otherCurrentAssets", label: "Other Current Assets", synonyms: ["other current assets"] },
      { key: "totalCurrentAssets", label: "Total Current Assets", bold: true, synonyms: ["total current assets"] },
    ],
  },
  {
    title: "NON-CURRENT ASSETS",
    items: [
      { key: "propertyPlantEquipmentNet", label: "Property, Plant & Equipment", synonyms: ["property, plant and equipment", "property plant and equipment", "tangible fixed assets", "ppe"] },
      { key: "goodwill", label: "Goodwill", synonyms: ["goodwill"] },
      { key: "intangibleAssets", label: "Intangible Assets", synonyms: ["intangible assets", "other intangible assets"] },
      { key: "longTermInvestments", label: "Long-Term Investments", synonyms: ["long-term investments", "non-current investments"] },
      { key: "deferredTaxAssetsNonCurrent", label: "Deferred Tax Assets", synonyms: ["deferred tax assets", "deferred tax asset"] },
      { key: "otherNonCurrentAssets", label: "Other Non-Current Assets", synonyms: ["other non-current assets", "other fixed assets"] },
      { key: "totalNonCurrentAssets", label: "Total Non-Current Assets", bold: true, synonyms: ["total non-current assets", "total fixed assets"] },
    ],
  },
  { title: "", items: [{ key: "totalAssets", label: "TOTAL ASSETS", bold: true, synonyms: ["total assets"] }] },
  {
    title: "CURRENT LIABILITIES",
    items: [
      { key: "accountPayables", label: "Accounts Payable", synonyms: ["trade and other payables", "trade payables", "accounts payable", "creditors"] },
      { key: "shortTermDebt", label: "Short-Term Debt", synonyms: ["short-term debt", "current borrowings", "short term borrowings"] },
      { key: "deferredRevenue", label: "Deferred Revenue", synonyms: ["deferred revenue", "contract liabilities"] },
      { key: "otherCurrentLiabilities", label: "Other Current Liabilities", synonyms: ["other current liabilities"] },
      { key: "totalCurrentLiabilities", label: "Total Current Liabilities", bold: true, synonyms: ["total current liabilities", "creditors: amounts falling due within one year"] },
    ],
  },
  {
    title: "NON-CURRENT LIABILITIES",
    items: [
      { key: "longTermDebt", label: "Long-Term Debt", synonyms: ["long-term debt", "non-current borrowings", "long term borrowings"] },
      { key: "deferredTaxLiabilitiesNonCurrent", label: "Deferred Tax Liabilities", synonyms: ["deferred tax liabilities", "deferred tax liability"] },
      { key: "otherNonCurrentLiabilities", label: "Other Non-Current Liabilities", synonyms: ["other non-current liabilities"] },
      { key: "totalNonCurrentLiabilities", label: "Total Non-Current Liabilities", bold: true, synonyms: ["total non-current liabilities", "creditors: amounts falling due after more than one year"] },
    ],
  },
  { title: "", items: [{ key: "totalLiabilities", label: "TOTAL LIABILITIES", bold: true, synonyms: ["total liabilities"] }] },
  {
    title: "STOCKHOLDERS' EQUITY",
    items: [
      { key: "commonStock", label: "Common Stock", synonyms: ["common stock", "share capital", "called up share capital"] },
      { key: "additionalPaidInCapital", label: "Additional Paid-in Capital", synonyms: ["additional paid-in capital", "share premium", "share premium account"] },
      { key: "retainedEarnings", label: "Retained Earnings", synonyms: ["retained earnings", "retained losses", "profit and loss account", "accumulated deficit"] },
      { key: "treasuryStock", label: "Treasury Stock", synonyms: ["treasury stock", "treasury shares"] },
      { key: "accumulatedOtherComprehensiveIncomeLoss", label: "Accumulated OCI", synonyms: ["accumulated other comprehensive income", "other reserves"] },
      { key: "totalStockholdersEquity", label: "Total Stockholders' Equity", bold: true, synonyms: ["total equity", "total shareholders' equity", "total stockholders' equity", "shareholders' funds", "total equity attributable to owners"] },
    ],
  },
  { title: "", items: [{ key: "totalLiabilitiesAndTotalEquity", label: "TOTAL LIABILITIES & EQUITY", bold: true, synonyms: ["total equity and liabilities", "total liabilities and equity"] }] },
];

export const INCOME_SECTIONS: CanonicalSection[] = [
  {
    title: "",
    items: [
      { key: "revenue", label: "Revenue", bold: true, synonyms: ["revenue", "turnover", "total revenue", "sales", "net sales"] },
      { key: "costOfRevenue", label: "Cost of Revenue", synonyms: ["cost of revenue", "cost of sales", "cost of goods sold"] },
      { key: "grossProfit", label: "Gross Profit", bold: true, synonyms: ["gross profit"] },
    ],
  },
  {
    title: "OPERATING EXPENSES",
    items: [
      { key: "researchAndDevelopmentExpenses", label: "Research & Development", synonyms: ["research and development", "research & development", "r&d expense"] },
      { key: "sellingGeneralAndAdministrativeExpenses", label: "Selling, General & Administrative", synonyms: ["selling, general and administrative", "administrative expenses", "sg&a"] },
      { key: "otherOperatingIncome", label: "Other Operating Income", synonyms: ["other operating income"] },
      { key: "operatingExpenses", label: "Total Operating Expenses", bold: true, synonyms: ["total operating expenses", "operating expenses"] },
    ],
  },
  { title: "", items: [{ key: "operatingIncome", label: "Operating Income", bold: true, synonyms: ["operating income", "operating profit", "profit from operations", "loss from operations", "operating loss"] }] },
  {
    title: "OTHER INCOME / EXPENSE",
    items: [
      { key: "interestExpense", label: "Interest Expense", synonyms: ["interest expense", "finance costs", "finance expense"] },
      { key: "interestIncome", label: "Interest Income", synonyms: ["interest income", "finance income"] },
      { key: "totalOtherIncomeExpensesNet", label: "Other Income/Expense, Net", synonyms: ["other income/expense, net", "other gains and losses"] },
    ],
  },
  {
    title: "",
    items: [
      { key: "incomeBeforeTax", label: "Income Before Tax", bold: true, synonyms: ["income before tax", "profit before tax", "loss before tax", "profit/(loss) before taxation"] },
      { key: "incomeTaxExpense", label: "Income Tax Expense", synonyms: ["income tax expense", "taxation", "tax charge"] },
      { key: "netIncome", label: "NET INCOME", bold: true, synonyms: ["net income", "profit for the year", "loss for the year", "profit/(loss) for the year", "net profit"] },
    ],
  },
  {
    title: "PER-SHARE DATA",
    items: [
      { key: "eps", label: "EPS (Basic)", synonyms: ["earnings per share (basic)", "basic earnings per share", "basic eps"] },
      { key: "epsDiluted", label: "EPS (Diluted)", synonyms: ["earnings per share (diluted)", "diluted earnings per share", "diluted eps"] },
      { key: "weightedAverageShsOut", label: "Weighted Average Shares Outstanding (Basic)", synonyms: ["weighted average shares outstanding", "weighted average shares outstanding basic", "basic weighted average shares"] },
      { key: "weightedAverageShsOutDil", label: "Weighted Average Shares Outstanding (Diluted)", synonyms: ["weighted average diluted shares outstanding", "diluted weighted average shares outstanding", "diluted weighted average shares"] },
    ],
  },
  {
    title: "SUPPLEMENTAL",
    items: [
      { key: "ebitda", label: "EBITDA", synonyms: ["ebitda"] },
      { key: "ebit", label: "EBIT", synonyms: ["ebit"] },
      { key: "depreciationAndAmortization", label: "Depreciation & Amortization", synonyms: ["depreciation and amortisation", "depreciation and amortization", "depreciation & amortisation"] },
    ],
  },
];

// Field names verified against real cached AAPL filed data (LSE
// financial_reports, report_type=cashflow) rather than guessed -- matches
// a standard FMP-style cash-flow-statement schema.
export const CASHFLOW_SECTIONS: CanonicalSection[] = [
  {
    title: "OPERATING ACTIVITIES",
    items: [
      { key: "netIncome", label: "Net Income", bold: true, synonyms: ["profit for the year", "loss for the year", "net income"] },
      { key: "depreciationAndAmortization", label: "Depreciation & Amortization", synonyms: ["depreciation and amortisation", "depreciation and amortization"] },
      { key: "stockBasedCompensation", label: "Stock-Based Compensation", synonyms: ["share-based payments", "stock-based compensation", "share based payment expense"] },
      { key: "deferredIncomeTax", label: "Deferred Income Tax", synonyms: ["deferred income tax", "deferred tax movement"] },
      { key: "otherNonCashItems", label: "Other Non-Cash Items", synonyms: ["other non-cash items"] },
      { key: "accountsReceivables", label: "Change in Accounts Receivable", synonyms: ["(increase)/decrease in receivables", "change in trade and other receivables", "increase in receivables"] },
      { key: "inventory", label: "Change in Inventory", synonyms: ["(increase)/decrease in inventories", "change in inventories"] },
      { key: "accountsPayables", label: "Change in Accounts Payable", synonyms: ["increase/(decrease) in payables", "change in trade and other payables"] },
      { key: "otherWorkingCapital", label: "Other Working Capital", synonyms: ["other working capital"] },
      { key: "netCashProvidedByOperatingActivities", label: "Net Cash from Operating Activities", bold: true, synonyms: ["net cash from operating activities", "net cash generated from operating activities", "net cash used in operating activities", "cash flows from operating activities"] },
    ],
  },
  {
    title: "INVESTING ACTIVITIES",
    items: [
      { key: "investmentsInPropertyPlantAndEquipment", label: "Capital Expenditure (PP&E)", synonyms: ["purchase of property, plant and equipment", "purchases of property, plant and equipment", "capital expenditure"] },
      { key: "acquisitionsNet", label: "Acquisitions, Net", synonyms: ["acquisitions, net of cash acquired", "acquisition of subsidiary"] },
      { key: "purchasesOfInvestments", label: "Purchases of Investments", synonyms: ["purchase of investments", "purchases of investments"] },
      { key: "salesMaturitiesOfInvestments", label: "Sales/Maturities of Investments", synonyms: ["proceeds from sale of investments", "sales/maturities of investments"] },
      { key: "otherInvestingActivities", label: "Other Investing Activities", synonyms: ["other investing activities"] },
      { key: "netCashProvidedByInvestingActivities", label: "Net Cash from Investing Activities", bold: true, synonyms: ["net cash used in investing activities", "net cash from investing activities", "cash flows from investing activities"] },
    ],
  },
  {
    title: "FINANCING ACTIVITIES",
    items: [
      { key: "netDebtIssuance", label: "Net Debt Issuance / (Repayment)", synonyms: ["proceeds from borrowings", "repayment of borrowings", "net debt issuance"] },
      { key: "commonStockIssuance", label: "Common Stock Issued", synonyms: ["proceeds from issue of shares", "proceeds from issuance of common stock", "issue of share capital"] },
      { key: "commonStockRepurchased", label: "Common Stock Repurchased", synonyms: ["repurchase of common stock", "share buybacks"] },
      { key: "commonDividendsPaid", label: "Common Dividends Paid", synonyms: ["dividends paid", "equity dividends paid"] },
      { key: "otherFinancingActivities", label: "Other Financing Activities", synonyms: ["other financing activities"] },
      { key: "netCashProvidedByFinancingActivities", label: "Net Cash from Financing Activities", bold: true, synonyms: ["net cash from financing activities", "net cash used in financing activities", "cash flows from financing activities"] },
    ],
  },
  {
    title: "",
    items: [
      { key: "effectOfForexChangesOnCash", label: "Effect of FX Changes on Cash", synonyms: ["effect of exchange rate changes", "effect of foreign exchange"] },
      { key: "netChangeInCash", label: "Net Change in Cash", bold: true, synonyms: ["net increase in cash", "net decrease in cash", "net change in cash and cash equivalents"] },
      { key: "cashAtBeginningOfPeriod", label: "Cash at Beginning of Period", synonyms: ["cash at beginning of year", "cash and cash equivalents at beginning of period"] },
      { key: "cashAtEndOfPeriod", label: "Cash at End of Period", bold: true, synonyms: ["cash at end of year", "cash and cash equivalents at end of period"] },
    ],
  },
  {
    title: "SUPPLEMENTAL",
    items: [
      { key: "capitalExpenditure", label: "Capital Expenditure" },
      { key: "freeCashFlow", label: "Free Cash Flow", bold: true },
      { key: "incomeTaxesPaid", label: "Income Taxes Paid" },
      { key: "interestPaid", label: "Interest Paid" },
    ],
  },
];

export const CANONICAL_SECTIONS: Record<StatementType, CanonicalSection[]> = {
  balance: BALANCE_SECTIONS,
  income: INCOME_SECTIONS,
  cashflow: CASHFLOW_SECTIONS,
};

// Derived, flattened views -- computed once at module load (not per-call),
// so every consumer gets O(1) lookups instead of re-flattening the section
// tree on every request.
export const CANONICAL_FIELDS: Record<StatementType, CanonicalLineItem[]> = {
  balance: BALANCE_SECTIONS.flatMap((s) => s.items),
  income: INCOME_SECTIONS.flatMap((s) => s.items),
  cashflow: CASHFLOW_SECTIONS.flatMap((s) => s.items),
};

export const CANONICAL_KEYS: Record<StatementType, Set<string>> = {
  balance: new Set(CANONICAL_FIELDS.balance.map((f) => f.key)),
  income: new Set(CANONICAL_FIELDS.income.map((f) => f.key)),
  cashflow: new Set(CANONICAL_FIELDS.cashflow.map((f) => f.key)),
};

export function isCanonicalKey(statementType: StatementType, key: string): boolean {
  return CANONICAL_KEYS[statementType].has(key);
}
