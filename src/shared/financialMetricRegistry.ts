import { evaluateFinanceFormula } from "./financeFormula";

export type FinancialMetricStatus =
  | "live" | "filed" | "estimate" | "derived" | "manual" | "imported"
  | "missing" | "stale" | "conflict" | "not-applicable";

export type FinancialMetricUnit =
  | "currency" | "price" | "currency-per-share" | "percent" | "ratio" | "multiple"
  | "days" | "turnover" | "count" | "bps" | "yield" | "volatility" | "text";

export type FinancialMetricCategory =
  | "market" | "statement" | "valuation" | "growth" | "margin" | "returns" | "liquidity"
  | "leverage" | "coverage" | "efficiency" | "cash-quality" | "capital-allocation" | "estimates"
  | "credit" | "fixed-income" | "derivatives" | "portfolio" | "ownership" | "sector-kpi";

export interface FinancialMetricDefinition {
  id: string;
  label: string;
  shortLabel?: string;
  aliases?: readonly string[];
  category: FinancialMetricCategory;
  unit: FinancialMetricUnit;
  description?: string;
  formula?: string;
  dependencies?: readonly string[];
  optionalDependencies?: readonly string[];
  minimumDependencyCount?: number;
  sectors?: readonly string[];
  higherIsBetter?: boolean | null;
  annualizable?: boolean;
  calculate?: (values: Readonly<Record<string, number | null>>) => number | null;
}

export interface FinancialMetricObservation {
  metricId: string;
  value: number | null;
  status: FinancialMetricStatus;
  period?: string;
  asOf?: string;
  publishedAt?: string;
  vintageAt?: string;
  source?: string;
  sourceUrl?: string;
  currency?: string;
  note?: string;
  confidence?: number;
  scenarioId?: string;
  manualOverride?: boolean;
}

export interface FinancialMetricTraceInput {
  metricId: string;
  value: number | null;
  status: FinancialMetricStatus;
  source?: string;
  period?: string;
  asOf?: string;
  currency?: string;
}

export interface ResolvedFinancialMetric extends FinancialMetricObservation {
  definition: FinancialMetricDefinition;
  trace: FinancialMetricTraceInput[];
  missingDependencies: string[];
  formula?: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const safeDiv = (a: number | null, b: number | null) => finite(a) && finite(b) && b !== 0 ? a / b : null;
const pctGrowth = (current: number | null, prior: number | null) => finite(current) && finite(prior) && prior !== 0 ? (current - prior) / Math.abs(prior) : null;

const RAW: FinancialMetricDefinition[] = [];
function raw(id: string, label: string, category: FinancialMetricCategory, unit: FinancialMetricUnit, aliases: string[] = [], extra: Partial<FinancialMetricDefinition> = {}) {
  RAW.push({ id, label, category, unit, aliases, ...extra });
}
function derived(definition: FinancialMetricDefinition): FinancialMetricDefinition { return definition; }

// Market and capital-structure primitives.
raw("price", "Price", "market", "price", ["last price", "share price"]);
raw("sharesOutstanding", "Shares Outstanding", "market", "count", ["basic shares", "shares out"]);
raw("dilutedShares", "Diluted Shares", "market", "count", ["fully diluted shares", "fds"]);
raw("marketCap", "Market Capitalization", "market", "currency", ["market cap", "equity value"]);
raw("cash", "Cash & Cash Equivalents", "statement", "currency", ["cash and equivalents"]);
raw("shortTermInvestments", "Short-Term Investments", "statement", "currency", ["marketable securities"]);
raw("nonOperatingInvestments", "Non-Operating Investments", "statement", "currency", ["non operating investments"]);
raw("shortTermDebt", "Short-Term Debt", "statement", "currency", ["current debt"]);
raw("longTermDebt", "Long-Term Debt", "statement", "currency", ["lt debt"]);
raw("leaseLiabilities", "Lease Liabilities", "statement", "currency", ["operating lease liabilities"]);
raw("preferredStock", "Preferred Equity", "statement", "currency", ["preferred stock"]);
raw("minorityInterest", "Minority Interest", "statement", "currency", ["noncontrolling interest", "nci"]);
raw("unfundedPension", "Unfunded Pension Obligation", "statement", "currency", ["pension deficit"]);
raw("enterpriseValue", "Enterprise Value", "valuation", "currency", ["ev"]);

// Income-statement and cash-flow primitives.
for (const [id, label] of [
  ["revenue", "Revenue"], ["costOfRevenue", "Cost of Revenue"], ["grossProfit", "Gross Profit"],
  ["sga", "Selling, General & Administrative"], ["rd", "Research & Development"], ["stockBasedCompensation", "Stock-Based Compensation"],
  ["restructuringCharges", "Restructuring Charges"], ["ebitda", "EBITDA"], ["adjustedEbitda", "Adjusted EBITDA"], ["ebita", "EBITA"],
  ["ebit", "EBIT"], ["operatingIncome", "Operating Income"], ["interestExpense", "Interest Expense"],
  ["incomeBeforeTax", "Income Before Tax"], ["incomeTaxExpense", "Income Tax Expense"], ["netIncome", "Net Income"],
  ["epsBasic", "Basic EPS"], ["epsDiluted", "Diluted EPS"], ["depreciationAndAmortization", "Depreciation & Amortization"],
  ["cfo", "Cash from Operations"], ["capex", "Capital Expenditure"], ["fcf", "Free Cash Flow"],
  ["dividendsPaid", "Dividends Paid"], ["shareRepurchases", "Share Repurchases"], ["acquisitions", "Acquisitions"],
] as const) raw(id, label, "statement", id.startsWith("eps") ? "currency-per-share" : "currency");
const revenueDefinition = RAW.find(metric => metric.id === "revenue");
if (revenueDefinition) revenueDefinition.aliases = ["sales", "turnover", "revenues"];
// Balance-sheet primitives.
for (const [id, label] of [
  ["receivables", "Accounts Receivable"], ["inventory", "Inventory"], ["payables", "Accounts Payable"],
  ["currentAssets", "Current Assets"], ["currentLiabilities", "Current Liabilities"], ["totalAssets", "Total Assets"],
  ["totalLiabilities", "Total Liabilities"], ["totalEquity", "Total Equity"], ["tangibleBookValue", "Tangible Book Value"],
  ["ppe", "Property, Plant & Equipment"], ["goodwill", "Goodwill"], ["intangibles", "Intangible Assets"],
  ["workingCapital", "Working Capital"], ["investedCapital", "Invested Capital"], ["capitalEmployed", "Capital Employed"],
] as const) raw(id, label, "statement", "currency");

// Market distributions, payout and estimates.
raw("dividendPerShare", "Dividend Per Share", "capital-allocation", "currency-per-share", ["dps"]);
raw("buybacks", "Buybacks", "capital-allocation", "currency", ["repurchases"]);
raw("wacc", "WACC", "valuation", "percent", ["weighted average cost of capital"]);
raw("revenueNtm", "Revenue NTM", "estimates", "currency", ["ntm revenue", "forward revenue"]);
raw("ebitdaNtm", "EBITDA NTM", "estimates", "currency", ["ntm ebitda", "forward ebitda"]);
raw("ebitNtm", "EBIT NTM", "estimates", "currency", ["ntm ebit"]);
raw("epsNtm", "EPS NTM", "estimates", "currency-per-share", ["ntm eps", "forward eps"]);
raw("fcfNtm", "FCF NTM", "estimates", "currency", ["ntm fcf", "forward fcf"]);
raw("epsGrowthNtm", "EPS Growth NTM", "estimates", "percent", ["forward eps growth"]);
raw("consensusTargetPrice", "Consensus Target Price", "estimates", "price", ["target price"]);
raw("estimateRevision30d", "Estimate Revision 30D", "estimates", "percent", ["30 day revisions"]);
raw("estimateRevision90d", "Estimate Revision 90D", "estimates", "percent", ["90 day revisions"]);
raw("estimateDispersion", "Estimate Dispersion", "estimates", "percent", ["consensus dispersion"]);

const DERIVED: FinancialMetricDefinition[] = [
  derived({ id: "grossDebt", label: "Gross Debt", category: "leverage", unit: "currency", formula: "shortTermDebt + longTermDebt", dependencies: ["shortTermDebt", "longTermDebt"], minimumDependencyCount: 1, calculate: v => {
    const values = [v.shortTermDebt, v.longTermDebt].filter(finite); return values.length ? values.reduce((a, b) => a + b, 0) : null;
  }}),
  derived({ id: "netDebt", label: "Net Debt", category: "leverage", unit: "currency", formula: "grossDebt + leaseLiabilities - cash - shortTermInvestments", dependencies: ["grossDebt", "cash"], optionalDependencies: ["leaseLiabilities", "shortTermInvestments"], calculate: v => finite(v.grossDebt) && finite(v.cash) ? v.grossDebt + (v.leaseLiabilities ?? 0) - v.cash - (v.shortTermInvestments ?? 0) : null }),
  derived({ id: "enterpriseValueDerived", label: "Enterprise Value (Derived)", category: "valuation", unit: "currency", formula: "marketCap + grossDebt + leaseLiabilities + preferredStock + minorityInterest + unfundedPension - cash - shortTermInvestments - nonOperatingInvestments", dependencies: ["marketCap", "grossDebt", "cash"], optionalDependencies: ["leaseLiabilities", "preferredStock", "minorityInterest", "unfundedPension", "shortTermInvestments", "nonOperatingInvestments"], calculate: v => finite(v.marketCap) && finite(v.grossDebt) && finite(v.cash) ? v.marketCap + v.grossDebt + (v.leaseLiabilities ?? 0) + (v.preferredStock ?? 0) + (v.minorityInterest ?? 0) + (v.unfundedPension ?? 0) - v.cash - (v.shortTermInvestments ?? 0) - (v.nonOperatingInvestments ?? 0) : null }),
  derived({ id: "marketCapDerived", label: "Market Capitalization (Derived)", category: "market", unit: "currency", formula: "price * dilutedShares", dependencies: ["price", "dilutedShares"], calculate: v => finite(v.price) && finite(v.dilutedShares) ? v.price * v.dilutedShares : null }),
  derived({ id: "fcfDerived", label: "Free Cash Flow (Derived)", category: "cash-quality", unit: "currency", formula: "cfo - abs(capex)", dependencies: ["cfo", "capex"], calculate: v => finite(v.cfo) && finite(v.capex) ? v.cfo - Math.abs(v.capex) : null }),
  derived({ id: "workingCapitalDerived", label: "Working Capital (Derived)", category: "liquidity", unit: "currency", formula: "currentAssets - currentLiabilities", dependencies: ["currentAssets", "currentLiabilities"], calculate: v => finite(v.currentAssets) && finite(v.currentLiabilities) ? v.currentAssets - v.currentLiabilities : null }),

  // Equity valuation multiples.
  derived({ id: "pe", label: "P/E", category: "valuation", unit: "multiple", aliases: ["price earnings", "price/earnings"], formula: "price / epsDiluted", dependencies: ["price", "epsDiluted"], calculate: v => safeDiv(v.price, v.epsDiluted) }),
  derived({ id: "forwardPE", label: "Forward P/E", category: "valuation", unit: "multiple", aliases: ["ntm p/e"], formula: "price / epsNtm", dependencies: ["price", "epsNtm"], calculate: v => safeDiv(v.price, v.epsNtm) }),
  derived({ id: "ps", label: "P/Sales", category: "valuation", unit: "multiple", aliases: ["p/s", "price sales"], formula: "marketCap / revenue", dependencies: ["marketCap", "revenue"], calculate: v => safeDiv(v.marketCap, v.revenue) }),
  derived({ id: "pb", label: "P/Book", category: "valuation", unit: "multiple", aliases: ["p/b", "price book"], formula: "marketCap / totalEquity", dependencies: ["marketCap", "totalEquity"], calculate: v => safeDiv(v.marketCap, v.totalEquity) }),
  derived({ id: "ptbv", label: "P/Tangible Book", category: "valuation", unit: "multiple", aliases: ["p/tbv"], formula: "marketCap / tangibleBookValue", dependencies: ["marketCap", "tangibleBookValue"], calculate: v => safeDiv(v.marketCap, v.tangibleBookValue) }),
  derived({ id: "pfcf", label: "P/FCF", category: "valuation", unit: "multiple", formula: "marketCap / fcf", dependencies: ["marketCap", "fcf"], calculate: v => safeDiv(v.marketCap, v.fcf) }),
  derived({ id: "pcfo", label: "P/CFO", category: "valuation", unit: "multiple", formula: "marketCap / cfo", dependencies: ["marketCap", "cfo"], calculate: v => safeDiv(v.marketCap, v.cfo) }),
  derived({ id: "peg", label: "PEG", category: "valuation", unit: "multiple", formula: "P/E / EPS growth NTM (%)", dependencies: ["pe", "epsGrowthNtm"], calculate: v => finite(v.pe) && finite(v.epsGrowthNtm) && v.epsGrowthNtm !== 0 ? v.pe / (v.epsGrowthNtm * 100) : null }),

  // Enterprise-value multiples.
  ...([[
    "evRevenue", "EV/Revenue", "revenue"], ["evEbitda", "EV/EBITDA", "ebitda"], ["evEbit", "EV/EBIT", "ebit"],
    ["evEbita", "EV/EBITA", "ebita"], ["evFcf", "EV/FCF", "fcf"], ["evCfo", "EV/CFO", "cfo"],
  ] as const).map(([id, label, denominator]) => derived({ id, label, category: "valuation", unit: "multiple", aliases: [label.replace("/", " to ")], formula: `enterpriseValue / ${denominator}`, dependencies: ["enterpriseValue", denominator], calculate: v => safeDiv(v.enterpriseValue, v[denominator]) })),
  derived({ id: "evEbitdaNtm", label: "EV/EBITDA NTM", category: "valuation", unit: "multiple", aliases: ["forward ev/ebitda"], formula: "enterpriseValue / ebitdaNtm", dependencies: ["enterpriseValue", "ebitdaNtm"], calculate: v => safeDiv(v.enterpriseValue, v.ebitdaNtm) }),
  derived({ id: "evRevenueNtm", label: "EV/Revenue NTM", category: "valuation", unit: "multiple", formula: "enterpriseValue / revenueNtm", dependencies: ["enterpriseValue", "revenueNtm"], calculate: v => safeDiv(v.enterpriseValue, v.revenueNtm) }),

  // Yields.
  derived({ id: "earningsYield", label: "Earnings Yield", category: "valuation", unit: "percent", formula: "netIncome / marketCap", dependencies: ["netIncome", "marketCap"], calculate: v => safeDiv(v.netIncome, v.marketCap) }),
  derived({ id: "fcfYield", label: "FCF Yield", category: "valuation", unit: "percent", formula: "fcf / marketCap", dependencies: ["fcf", "marketCap"], calculate: v => safeDiv(v.fcf, v.marketCap) }),
  derived({ id: "cfoYield", label: "CFO Yield", category: "valuation", unit: "percent", formula: "cfo / marketCap", dependencies: ["cfo", "marketCap"], calculate: v => safeDiv(v.cfo, v.marketCap) }),
  derived({ id: "dividendYield", label: "Dividend Yield", category: "valuation", unit: "percent", formula: "dividendPerShare / price", dependencies: ["dividendPerShare", "price"], calculate: v => safeDiv(v.dividendPerShare, v.price) }),
  derived({ id: "buybackYield", label: "Buyback Yield", category: "capital-allocation", unit: "percent", formula: "buybacks / marketCap", dependencies: ["buybacks", "marketCap"], calculate: v => safeDiv(v.buybacks, v.marketCap) }),
  derived({ id: "shareholderYield", label: "Shareholder Yield", category: "capital-allocation", unit: "percent", formula: "dividendYield + buybackYield", dependencies: ["dividendYield", "buybackYield"], calculate: v => finite(v.dividendYield) && finite(v.buybackYield) ? v.dividendYield + v.buybackYield : null }),

  // Margins and returns.
  ...([[
    "grossMargin", "Gross Margin", "grossProfit"], ["ebitdaMargin", "EBITDA Margin", "ebitda"],
    ["ebitMargin", "EBIT Margin", "ebit"], ["netMargin", "Net Margin", "netIncome"], ["fcfMargin", "FCF Margin", "fcf"],
  ] as const).map(([id, label, numerator]) => derived({ id, label, category: "margin", unit: "percent", formula: `${numerator} / revenue`, dependencies: [numerator, "revenue"], higherIsBetter: true, calculate: v => safeDiv(v[numerator], v.revenue) })),
  derived({ id: "roa", label: "Return on Assets", shortLabel: "ROA", category: "returns", unit: "percent", formula: "netIncome / totalAssets", dependencies: ["netIncome", "totalAssets"], higherIsBetter: true, calculate: v => safeDiv(v.netIncome, v.totalAssets) }),
  derived({ id: "roe", label: "Return on Equity", shortLabel: "ROE", category: "returns", unit: "percent", formula: "netIncome / totalEquity", dependencies: ["netIncome", "totalEquity"], higherIsBetter: true, calculate: v => safeDiv(v.netIncome, v.totalEquity) }),
  derived({ id: "roic", label: "Return on Invested Capital", shortLabel: "ROIC", category: "returns", unit: "percent", formula: "EBIT * (1 - effectiveTaxRate) / investedCapital", dependencies: ["ebit", "effectiveTaxRate", "investedCapital"], higherIsBetter: true, calculate: v => finite(v.ebit) && finite(v.effectiveTaxRate) ? safeDiv(v.ebit * (1 - v.effectiveTaxRate), v.investedCapital) : null }),
  derived({ id: "roce", label: "Return on Capital Employed", shortLabel: "ROCE", category: "returns", unit: "percent", formula: "ebit / capitalEmployed", dependencies: ["ebit", "capitalEmployed"], higherIsBetter: true, calculate: v => safeDiv(v.ebit, v.capitalEmployed) }),
  derived({ id: "croic", label: "Cash Return on Invested Capital", shortLabel: "CROIC", category: "returns", unit: "percent", formula: "fcf / investedCapital", dependencies: ["fcf", "investedCapital"], higherIsBetter: true, calculate: v => safeDiv(v.fcf, v.investedCapital) }),
  derived({ id: "roicWaccSpread", label: "ROIC - WACC Spread", category: "returns", unit: "percent", formula: "roic - wacc", dependencies: ["roic", "wacc"], higherIsBetter: true, calculate: v => finite(v.roic) && finite(v.wacc) ? v.roic - v.wacc : null }),
  derived({ id: "effectiveTaxRate", label: "Effective Tax Rate", category: "margin", unit: "percent", formula: "incomeTaxExpense / incomeBeforeTax", dependencies: ["incomeTaxExpense", "incomeBeforeTax"], calculate: v => safeDiv(v.incomeTaxExpense, v.incomeBeforeTax) }),
  derived({ id: "investedCapitalDerived", label: "Invested Capital (Derived)", category: "returns", unit: "currency", formula: "grossDebt + totalEquity - cash - shortTermInvestments", dependencies: ["grossDebt", "totalEquity", "cash"], optionalDependencies: ["shortTermInvestments"], calculate: v => finite(v.grossDebt) && finite(v.totalEquity) && finite(v.cash) ? v.grossDebt + v.totalEquity - v.cash - (v.shortTermInvestments ?? 0) : null }),
  derived({ id: "capitalEmployedDerived", label: "Capital Employed (Derived)", category: "returns", unit: "currency", formula: "totalAssets - currentLiabilities", dependencies: ["totalAssets", "currentLiabilities"], calculate: v => finite(v.totalAssets) && finite(v.currentLiabilities) ? v.totalAssets - v.currentLiabilities : null }),

  // Liquidity, leverage and coverage.
  derived({ id: "currentRatio", label: "Current Ratio", category: "liquidity", unit: "ratio", formula: "currentAssets / currentLiabilities", dependencies: ["currentAssets", "currentLiabilities"], calculate: v => safeDiv(v.currentAssets, v.currentLiabilities) }),
  derived({ id: "quickRatio", label: "Quick Ratio", category: "liquidity", unit: "ratio", formula: "(currentAssets - inventory) / currentLiabilities", dependencies: ["currentAssets", "inventory", "currentLiabilities"], calculate: v => finite(v.currentAssets) && finite(v.inventory) ? safeDiv(v.currentAssets - v.inventory, v.currentLiabilities) : null }),
  derived({ id: "cashRatio", label: "Cash Ratio", category: "liquidity", unit: "ratio", formula: "cash / currentLiabilities", dependencies: ["cash", "currentLiabilities"], calculate: v => safeDiv(v.cash, v.currentLiabilities) }),
  derived({ id: "debtEquity", label: "Debt / Equity", category: "leverage", unit: "multiple", formula: "grossDebt / totalEquity", dependencies: ["grossDebt", "totalEquity"], calculate: v => safeDiv(v.grossDebt, v.totalEquity) }),
  derived({ id: "debtCapital", label: "Debt / Capital", category: "leverage", unit: "percent", formula: "grossDebt / (grossDebt + totalEquity)", dependencies: ["grossDebt", "totalEquity"], calculate: v => finite(v.grossDebt) && finite(v.totalEquity) ? safeDiv(v.grossDebt, v.grossDebt + v.totalEquity) : null }),
  derived({ id: "grossDebtEbitda", label: "Gross Debt / EBITDA", category: "leverage", unit: "multiple", formula: "grossDebt / ebitda", dependencies: ["grossDebt", "ebitda"], calculate: v => safeDiv(v.grossDebt, v.ebitda) }),
  derived({ id: "netDebtEbitda", label: "Net Debt / EBITDA", category: "leverage", unit: "multiple", formula: "netDebt / ebitda", dependencies: ["netDebt", "ebitda"], calculate: v => safeDiv(v.netDebt, v.ebitda) }),
  derived({ id: "debtFcf", label: "Debt / FCF", category: "leverage", unit: "multiple", formula: "grossDebt / fcf", dependencies: ["grossDebt", "fcf"], calculate: v => safeDiv(v.grossDebt, v.fcf) }),
  derived({ id: "cfoDebt", label: "CFO / Debt", category: "coverage", unit: "percent", formula: "cfo / grossDebt", dependencies: ["cfo", "grossDebt"], calculate: v => safeDiv(v.cfo, v.grossDebt) }),
  derived({ id: "interestCoverage", label: "Interest Coverage", category: "coverage", unit: "multiple", formula: "ebit / abs(interestExpense)", dependencies: ["ebit", "interestExpense"], calculate: v => finite(v.ebit) && finite(v.interestExpense) ? safeDiv(v.ebit, Math.abs(v.interestExpense)) : null }),

  // Efficiency and cash quality.
  derived({ id: "assetTurnover", label: "Asset Turnover", category: "efficiency", unit: "turnover", formula: "revenue / totalAssets", dependencies: ["revenue", "totalAssets"], calculate: v => safeDiv(v.revenue, v.totalAssets) }),
  derived({ id: "receivablesTurnover", label: "Receivables Turnover", category: "efficiency", unit: "turnover", formula: "revenue / receivables", dependencies: ["revenue", "receivables"], calculate: v => safeDiv(v.revenue, v.receivables) }),
  derived({ id: "inventoryTurnover", label: "Inventory Turnover", category: "efficiency", unit: "turnover", formula: "abs(costOfRevenue) / inventory", dependencies: ["costOfRevenue", "inventory"], calculate: v => finite(v.costOfRevenue) ? safeDiv(Math.abs(v.costOfRevenue), v.inventory) : null }),
  derived({ id: "payablesTurnover", label: "Payables Turnover", category: "efficiency", unit: "turnover", formula: "abs(costOfRevenue) / payables", dependencies: ["costOfRevenue", "payables"], calculate: v => finite(v.costOfRevenue) ? safeDiv(Math.abs(v.costOfRevenue), v.payables) : null }),
  derived({ id: "dso", label: "Days Sales Outstanding", shortLabel: "DSO", category: "efficiency", unit: "days", formula: "365 / receivablesTurnover", dependencies: ["receivablesTurnover"], calculate: v => finite(v.receivablesTurnover) ? safeDiv(365, v.receivablesTurnover) : null }),
  derived({ id: "dio", label: "Days Inventory Outstanding", shortLabel: "DIO", category: "efficiency", unit: "days", formula: "365 / inventoryTurnover", dependencies: ["inventoryTurnover"], calculate: v => finite(v.inventoryTurnover) ? safeDiv(365, v.inventoryTurnover) : null }),
  derived({ id: "dpo", label: "Days Payables Outstanding", shortLabel: "DPO", category: "efficiency", unit: "days", formula: "365 / payablesTurnover", dependencies: ["payablesTurnover"], calculate: v => finite(v.payablesTurnover) ? safeDiv(365, v.payablesTurnover) : null }),
  derived({ id: "cashConversionCycle", label: "Cash Conversion Cycle", shortLabel: "CCC", category: "efficiency", unit: "days", formula: "dso + dio - dpo", dependencies: ["dso", "dio", "dpo"], calculate: v => finite(v.dso) && finite(v.dio) && finite(v.dpo) ? v.dso + v.dio - v.dpo : null }),
  derived({ id: "fcfConversion", label: "FCF Conversion", category: "cash-quality", unit: "percent", formula: "fcf / netIncome", dependencies: ["fcf", "netIncome"], calculate: v => safeDiv(v.fcf, v.netIncome) }),
  derived({ id: "cfoNetIncome", label: "CFO / Net Income", category: "cash-quality", unit: "ratio", formula: "cfo / netIncome", dependencies: ["cfo", "netIncome"], calculate: v => safeDiv(v.cfo, v.netIncome) }),
  derived({ id: "capexIntensity", label: "Capex Intensity", category: "capital-allocation", unit: "percent", formula: "abs(capex) / revenue", dependencies: ["capex", "revenue"], calculate: v => finite(v.capex) ? safeDiv(Math.abs(v.capex), v.revenue) : null }),
  derived({ id: "sbcRevenue", label: "SBC / Revenue", category: "cash-quality", unit: "percent", formula: "stockBasedCompensation / revenue", dependencies: ["stockBasedCompensation", "revenue"], calculate: v => safeDiv(v.stockBasedCompensation, v.revenue) }),
];

// Direct-only institutional metrics: provider/manual values can populate these even when a universal derivation is inappropriate.
const INSTITUTIONAL_DIRECT: Array<[string, string, FinancialMetricCategory, FinancialMetricUnit, string[]?]> = [
  ["revenueGrowth", "Revenue Growth", "growth", "percent"], ["ebitdaGrowth", "EBITDA Growth", "growth", "percent"], ["ebitGrowth", "EBIT Growth", "growth", "percent"], ["epsGrowth", "EPS Growth", "growth", "percent"], ["fcfGrowth", "FCF Growth", "growth", "percent"],
  ["dscr", "Debt Service Coverage Ratio", "coverage", "multiple", ["dscr"]], ["fixedChargeCoverage", "Fixed-Charge Coverage", "coverage", "multiple"], ["ffoDebt", "FFO / Debt", "credit", "percent"], ["debtMaturity1y", "Debt Due <1Y", "credit", "currency"], ["debtMaturity3y", "Debt Due <3Y", "credit", "currency"], ["creditSpread", "Credit Spread", "credit", "bps"], ["cdsSpread", "CDS Spread", "credit", "bps"], ["defaultProbability", "Default Probability", "credit", "percent"],
  ["ytm", "Yield to Maturity", "fixed-income", "yield", ["ytm"]], ["ytw", "Yield to Worst", "fixed-income", "yield", ["ytw"]], ["ytc", "Yield to Call", "fixed-income", "yield"], ["currentYield", "Current Yield", "fixed-income", "yield"], ["zSpread", "Z-Spread", "fixed-income", "bps"], ["oas", "Option-Adjusted Spread", "fixed-income", "bps", ["oas"]], ["duration", "Modified Duration", "fixed-income", "ratio"], ["effectiveDuration", "Effective Duration", "fixed-income", "ratio"], ["convexity", "Convexity", "fixed-income", "ratio"], ["dv01", "DV01", "fixed-income", "currency"], ["carry", "Carry", "fixed-income", "percent"], ["rolldown", "Rolldown", "fixed-income", "percent"],
  ["impliedVolatility", "Implied Volatility", "derivatives", "volatility", ["iv"]], ["realizedVolatility", "Realized Volatility", "derivatives", "volatility", ["rv"]], ["ivRank", "IV Rank", "derivatives", "percent"], ["ivPercentile", "IV Percentile", "derivatives", "percent"], ["delta", "Delta", "derivatives", "ratio"], ["gamma", "Gamma", "derivatives", "ratio"], ["vega", "Vega", "derivatives", "ratio"], ["theta", "Theta", "derivatives", "ratio"], ["rho", "Rho", "derivatives", "ratio"], ["putCallRatio", "Put/Call Ratio", "derivatives", "ratio"], ["gammaExposure", "Gamma Exposure", "derivatives", "currency"], ["expectedMove", "Expected Move", "derivatives", "percent"],
  ["twr", "Time-Weighted Return", "portfolio", "percent", ["twr"]], ["mwr", "Money-Weighted Return", "portfolio", "percent", ["irr", "mwr"]], ["sharpe", "Sharpe Ratio", "portfolio", "ratio"], ["sortino", "Sortino Ratio", "portfolio", "ratio"], ["calmar", "Calmar Ratio", "portfolio", "ratio"], ["informationRatio", "Information Ratio", "portfolio", "ratio"], ["trackingError", "Tracking Error", "portfolio", "volatility"], ["activeShare", "Active Share", "portfolio", "percent"], ["var", "Value at Risk", "portfolio", "currency", ["var"]], ["cvar", "Expected Shortfall / CVaR", "portfolio", "currency", ["expected shortfall", "cvar"]], ["maxDrawdown", "Maximum Drawdown", "portfolio", "percent"], ["portfolioBeta", "Portfolio Beta", "portfolio", "ratio"], ["riskContribution", "Risk Contribution", "portfolio", "percent"],
  ["institutionalOwnership", "Institutional Ownership", "ownership", "percent"], ["insiderOwnership", "Insider Ownership", "ownership", "percent"], ["shortInterestPctFloat", "Short Interest % Float", "ownership", "percent"], ["daysToCover", "Days to Cover", "ownership", "days"],
];
for (const [id, label, category, unit, aliases = []] of INSTITUTIONAL_DIRECT) raw(id, label, category, unit, aliases);

// Sector-specific KPI universe. These are intentionally direct/manual-capable because definitions vary by issuer/provider.
const SECTOR_KPIS: Array<[string, string, string[], FinancialMetricUnit]> = [
  ["bank.nim", "Net Interest Margin", ["banking", "banks"], "percent"], ["bank.casa", "CASA Ratio", ["banking", "banks"], "percent"], ["bank.gnpa", "Gross NPA Ratio", ["banking", "banks"], "percent"], ["bank.nnpa", "Net NPA Ratio", ["banking", "banks"], "percent"], ["bank.cet1", "CET1 Ratio", ["banking", "banks"], "percent"], ["bank.car", "Capital Adequacy Ratio", ["banking", "banks"], "percent"], ["bank.costOfRisk", "Cost of Risk", ["banking", "banks"], "percent"], ["bank.costIncome", "Cost / Income", ["banking", "banks"], "percent"],
  ["insurance.gwp", "Gross Written Premium", ["insurance"], "currency"], ["insurance.combinedRatio", "Combined Ratio", ["insurance"], "percent"], ["insurance.lossRatio", "Loss Ratio", ["insurance"], "percent"], ["insurance.solvency", "Solvency Ratio", ["insurance"], "percent"], ["insurance.embeddedValue", "Embedded Value", ["insurance"], "currency"], ["insurance.vnb", "Value of New Business", ["insurance"], "currency"],
  ["reit.noi", "Net Operating Income", ["reit", "real estate"], "currency"], ["reit.ffo", "Funds From Operations", ["reit", "real estate"], "currency"], ["reit.affo", "Adjusted FFO", ["reit", "real estate"], "currency"], ["reit.nav", "Net Asset Value", ["reit", "real estate"], "currency"], ["reit.occupancy", "Occupancy", ["reit", "real estate"], "percent"], ["reit.capRate", "Capitalization Rate", ["reit", "real estate"], "percent"], ["reit.wale", "WALE", ["reit", "real estate"], "ratio"],
  ["saas.arr", "Annual Recurring Revenue", ["software", "saas"], "currency"], ["saas.mrr", "Monthly Recurring Revenue", ["software", "saas"], "currency"], ["saas.nrr", "Net Revenue Retention", ["software", "saas"], "percent"], ["saas.grr", "Gross Revenue Retention", ["software", "saas"], "percent"], ["saas.churn", "Revenue Churn", ["software", "saas"], "percent"], ["saas.cac", "Customer Acquisition Cost", ["software", "saas"], "currency"], ["saas.ltv", "Lifetime Value", ["software", "saas"], "currency"], ["saas.cacPayback", "CAC Payback", ["software", "saas"], "ratio"], ["saas.ruleOf40", "Rule of 40", ["software", "saas"], "percent"], ["saas.rpo", "Remaining Performance Obligations", ["software", "saas"], "currency"],
  ["energy.production", "Production", ["energy", "oil & gas"], "count"], ["energy.reserves", "Proved Reserves", ["energy", "oil & gas"], "count"], ["energy.realizedPrice", "Realized Price", ["energy", "oil & gas"], "price"], ["energy.liftingCost", "Lifting Cost", ["energy", "oil & gas"], "price"], ["energy.findingDevelopmentCost", "Finding & Development Cost", ["energy", "oil & gas"], "price"], ["energy.recycleRatio", "Recycle Ratio", ["energy", "oil & gas"], "multiple"],
  ["airline.rasm", "Revenue per ASM", ["airlines"], "currency-per-share"], ["airline.casm", "Cost per ASM", ["airlines"], "currency-per-share"], ["airline.loadFactor", "Load Factor", ["airlines"], "percent"], ["airline.yield", "Passenger Yield", ["airlines"], "yield"], ["airline.ask", "Available Seat Kilometers", ["airlines"], "count"], ["airline.rpk", "Revenue Passenger Kilometers", ["airlines"], "count"],
  ["hotel.revpar", "RevPAR", ["hotels", "hospitality"], "price"], ["hotel.adr", "Average Daily Rate", ["hotels", "hospitality"], "price"], ["hotel.occupancy", "Occupancy", ["hotels", "hospitality"], "percent"],
  ["telecom.arpu", "ARPU", ["telecom"], "price"], ["telecom.churn", "Subscriber Churn", ["telecom"], "percent"], ["telecom.subscribers", "Subscribers", ["telecom"], "count"],
  ["semis.waferStarts", "Wafer Starts", ["semiconductors"], "count"], ["semis.utilization", "Fab Utilization", ["semiconductors"], "percent"], ["semis.asp", "Average Selling Price", ["semiconductors"], "price"],
  ["retail.sameStoreSales", "Same-Store Sales Growth", ["retail"], "percent"], ["retail.salesPerSqFt", "Sales / Sq Ft", ["retail"], "price"], ["retail.inventoryTurns", "Inventory Turns", ["retail"], "turnover"],
  ["auto.deliveries", "Vehicle Deliveries", ["automotive", "auto"], "count"], ["auto.asp", "Vehicle ASP", ["automotive", "auto"], "price"], ["auto.utilization", "Capacity Utilization", ["automotive", "auto"], "percent"],
  ["mining.aisc", "All-In Sustaining Cost", ["mining"], "price"], ["mining.production", "Production Volume", ["mining"], "count"], ["mining.reserveLife", "Reserve Life", ["mining"], "ratio"],
  ["shipping.tce", "Time Charter Equivalent", ["shipping"], "price"], ["shipping.utilization", "Fleet Utilization", ["shipping"], "percent"], ["shipping.orderbookFleet", "Orderbook / Fleet", ["shipping"], "percent"],
  ["biotech.cashRunway", "Cash Runway", ["biotech", "healthcare"], "ratio"], ["biotech.rndIntensity", "R&D / Revenue", ["biotech", "healthcare"], "percent"],
  ["payments.tpv", "Total Payment Volume", ["payments", "fintech"], "currency"], ["payments.takeRate", "Take Rate", ["payments", "fintech"], "percent"], ["payments.transactions", "Transactions", ["payments", "fintech"], "count"],
  ["assetMgmt.aum", "Assets Under Management", ["asset management"], "currency"], ["assetMgmt.netFlows", "Net Flows", ["asset management"], "currency"], ["assetMgmt.feeRate", "Management Fee Rate", ["asset management"], "percent"],
];
for (const [id, label, sectors, unit] of SECTOR_KPIS) raw(id, label, "sector-kpi", unit, [], { sectors });

export const FINANCIAL_METRICS: readonly FinancialMetricDefinition[] = [...RAW, ...DERIVED];
const BY_ID = new Map(FINANCIAL_METRICS.map(metric => [metric.id, metric]));
const ALIAS = new Map<string, string>();
for (const metric of FINANCIAL_METRICS) {
  for (const alias of [metric.id, metric.label, metric.shortLabel, ...(metric.aliases ?? [])].filter(Boolean) as string[]) {
    ALIAS.set(alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""), metric.id);
  }
}

export function getFinancialMetricDefinition(idOrAlias: string): FinancialMetricDefinition | null {
  const exact = BY_ID.get(idOrAlias);
  if (exact) return exact;
  const normalized = idOrAlias.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const id = ALIAS.get(normalized);
  return id ? BY_ID.get(id) ?? null : null;
}

export function searchFinancialMetrics(query: string, limit = 80): FinancialMetricDefinition[] {
  const q = query.trim().toLowerCase();
  const scored = FINANCIAL_METRICS.map(metric => {
    if (!q) return { metric, score: metric.category === "valuation" ? 3 : 1 };
    const haystack = [metric.id, metric.label, metric.shortLabel, ...(metric.aliases ?? []), metric.category, ...(metric.sectors ?? [])].filter(Boolean).join(" ").toLowerCase();
    let score = 0;
    if (metric.id.toLowerCase() === q || metric.label.toLowerCase() === q) score += 100;
    if (metric.label.toLowerCase().startsWith(q)) score += 50;
    if (haystack.includes(q)) score += 20;
    return { metric, score };
  });
  return scored.filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.metric.label.localeCompare(b.metric.label)).slice(0, limit).map(row => row.metric);
}

const STATUS_PRIORITY: Record<FinancialMetricStatus, number> = {
  manual: 100, imported: 90, filed: 80, live: 75, estimate: 70, derived: 50, conflict: 40, stale: 20, missing: 0, "not-applicable": -1,
};

function bestDirectObservation(metricId: string, observations: readonly FinancialMetricObservation[], period?: string, scenarioId?: string): FinancialMetricObservation | null {
  const matches = observations.filter(obs => obs.metricId === metricId && (period ? obs.period === period : true) && (scenarioId ? obs.scenarioId === scenarioId || !obs.scenarioId : true) && finite(obs.value));
  // Multi-year filed statements all carry the same status (e.g. "filed"),
  // so without a recency tiebreaker Array.prototype.sort's stability just
  // returns whichever fiscal year happened to be pushed first into the
  // observations array -- typically the OLDEST period, since providers
  // return statements oldest-to-newest. Break status/manual-override ties
  // by most-recent `asOf` (falling back to `period`, same convention
  // appendHistoricalGrowth already uses in financeObservations.ts) so a
  // metric with no explicit period request resolves to the latest real
  // observation, not an arbitrary stale one.
  return matches.sort((a, b) =>
    Number(Boolean(scenarioId && b.scenarioId === scenarioId)) - Number(Boolean(scenarioId && a.scenarioId === scenarioId))
    || STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status]
    || Number(Boolean(b.manualOverride)) - Number(Boolean(a.manualOverride))
    || (b.asOf ?? "").localeCompare(a.asOf ?? "")
    || (b.period ?? "").localeCompare(a.period ?? ""),
  )[0] ?? null;
}

export function resolveFinancialMetric(
  idOrAlias: string,
  observations: readonly FinancialMetricObservation[],
  options: { period?: string; scenarioId?: string } = {},
  visited: Set<string> = new Set(),
): ResolvedFinancialMetric | null {
  const definition = getFinancialMetricDefinition(idOrAlias);
  if (!definition) return null;
  if (visited.has(definition.id)) {
    return { metricId: definition.id, value: null, status: "conflict", definition, trace: [], missingDependencies: [definition.id], formula: definition.formula, note: "Circular financial metric dependency" };
  }

  const direct = bestDirectObservation(definition.id, observations, options.period, options.scenarioId);
  if (direct) return { ...direct, definition, trace: [], missingDependencies: [], formula: definition.formula };
  if (!definition.calculate && !definition.formula) {
    return { metricId: definition.id, value: null, status: "missing", period: options.period, scenarioId: options.scenarioId, definition, trace: [], missingDependencies: [definition.id] };
  }

  const nextVisited = new Set(visited).add(definition.id);
  const requiredIds = [...(definition.dependencies ?? [])];
  const optionalIds = [...(definition.optionalDependencies ?? [])];
  const trace: FinancialMetricTraceInput[] = [];
  const values: Record<string, number | null> = {};
  const missing: string[] = [];
  let availableRequired = 0;

  for (const dependency of requiredIds) {
    const resolved = resolveFinancialMetric(dependency, observations, options, nextVisited);
    values[dependency] = resolved?.value ?? null;
    trace.push({ metricId: dependency, value: resolved?.value ?? null, status: resolved?.status ?? "missing", source: resolved?.source, period: resolved?.period, asOf: resolved?.asOf, currency: resolved?.currency });
    if (finite(resolved?.value)) availableRequired += 1; else missing.push(dependency);
  }
  for (const dependency of optionalIds) {
    const resolved = resolveFinancialMetric(dependency, observations, options, nextVisited);
    values[dependency] = resolved?.value ?? 0;
    trace.push({ metricId: dependency, value: resolved?.value ?? null, status: resolved?.status ?? "missing", source: resolved?.source, period: resolved?.period, asOf: resolved?.asOf, currency: resolved?.currency });
  }

  const min = definition.minimumDependencyCount ?? requiredIds.length;
  if (availableRequired < min) {
    return { metricId: definition.id, value: null, status: "missing", period: options.period, scenarioId: options.scenarioId, definition, trace, missingDependencies: missing, formula: definition.formula };
  }

  const result = definition.calculate
    ? definition.calculate(values)
    : definition.formula
      ? evaluateFinanceFormula(definition.formula, values).value
      : null;
  const tracePeriods = trace.map(item => item.period).filter((period): period is string => Boolean(period));
  const traceAsOf = trace.map(item => item.asOf).filter((asOf): asOf is string => Boolean(asOf)).sort().at(-1);
  const traceCurrency = trace.map(item => item.currency).find((currency): currency is string => Boolean(currency));
  return {
    metricId: definition.id,
    value: finite(result) ? result : null,
    status: finite(result) ? "derived" : "missing",
    period: options.period ?? tracePeriods[0],
    scenarioId: options.scenarioId,
    asOf: traceAsOf,
    currency: traceCurrency,
    source: finite(result) ? "LiOS deterministic formula engine" : undefined,
    definition,
    trace,
    missingDependencies: finite(result) ? [] : missing,
    formula: definition.formula,
  };
}

export function financialMetricCoverage(observations: readonly FinancialMetricObservation[], sector?: string) {
  const applicable = FINANCIAL_METRICS.filter(metric => !metric.sectors?.length || !sector || metric.sectors.some(item => sector.toLowerCase().includes(item.toLowerCase())));
  const counts: Record<FinancialMetricStatus, number> = { live: 0, filed: 0, estimate: 0, derived: 0, manual: 0, imported: 0, missing: 0, stale: 0, conflict: 0, "not-applicable": 0 };
  for (const metric of applicable) {
    const resolved = resolveFinancialMetric(metric.id, observations);
    counts[resolved?.status ?? "missing"] += 1;
  }
  const available = applicable.length - counts.missing - counts["not-applicable"];
  return { total: applicable.length, available, coverage: applicable.length ? available / applicable.length : 0, counts };
}

export function formatFinancialMetricValue(value: number | null, unit: FinancialMetricUnit, currency = "$" ): string {
  if (!finite(value)) return "—";
  if (unit === "percent" || unit === "yield" || unit === "volatility") return `${(value * 100).toFixed(2)}%`;
  if (unit === "multiple" || unit === "ratio" || unit === "turnover") return `${value.toFixed(2)}x`;
  if (unit === "days") return `${value.toFixed(1)}d`;
  if (unit === "bps") return `${value.toFixed(0)} bp`;
  if (unit === "currency" || unit === "price" || unit === "currency-per-share") {
    const abs = Math.abs(value);
    if (unit === "currency" && abs >= 1e12) return `${currency}${(value / 1e12).toFixed(2)}T`;
    if (unit === "currency" && abs >= 1e9) return `${currency}${(value / 1e9).toFixed(2)}B`;
    if (unit === "currency" && abs >= 1e6) return `${currency}${(value / 1e6).toFixed(2)}M`;
    return `${currency}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function calculatePeriodGrowth(current: number | null, prior: number | null): number | null { return pctGrowth(current, prior); }
