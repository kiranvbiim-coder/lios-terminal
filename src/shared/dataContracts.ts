/**
 * Canonical Data Contracts: the semantic interface between data sources and
 * LiOS engines. Every engine declares which contracts it requires/accepts.
 * The contract resolver (Phase 5) checks connector capabilities against
 * engine declarations to determine readiness.
 *
 * Design rules:
 * - Engines ask for contracts, never providers.
 * - Contracts define WHAT data is needed, not WHERE it comes from.
 * - Every field has type, unit behavior, required/optional/manual status,
 *   and freshness requirements.
 */
import { CANONICAL_FIELDS } from "./financialFields";

// These 7 keys were required in the hand-written field list this module
// replaced (see git history: "harden canonical financial dataset
// contracts"). Every other canonical field remains optional: engines that
// need a specific line item beyond this baseline declare that need
// explicitly rather than the generic financial_statements contract
// silently requiring it for everyone.
const REQUIRED_FINANCIAL_STATEMENT_KEYS = new Set([
  "revenue", "operatingIncome", "netIncome", "totalAssets", "totalLiabilities", "totalStockholdersEquity", "cashAndCashEquivalents",
]);
const financialStatementFields: ContractField[] = [
  { name: "period", type: "string", requirement: "required", description: "Fiscal period (e.g. FY2024, Q3 2024)", dateBehavior: "fiscal_period" },
  { name: "periodEndDate", type: "date", requirement: "required", description: "Period end date", dateBehavior: "calendar_date" },
  { name: "currency", type: "string", requirement: "required", description: "Reporting currency (ISO 4217)" },
  ...Array.from(new Map(Object.values(CANONICAL_FIELDS).flatMap((fields) => fields.map((field) => [
    field.key,
    { name: field.key, type: "currency_amount", requirement: REQUIRED_FINANCIAL_STATEMENT_KEYS.has(field.key) ? "required" : "optional", description: field.label, currencyBehavior: "reporting_currency" } satisfies ContractField,
  ]))).values()),
];


export type ContractFieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "timestamp"
  | "currency_amount"
  | "percentage"
  | "ratio"
  | "array"
  | "object";

export type ContractFieldRequirement = "required" | "optional" | "manual";

export interface ContractField {
  name: string;
  type: ContractFieldType;
  requirement: ContractFieldRequirement;
  description: string;
  unit?: string;
  currencyBehavior?: "reporting_currency" | "specified" | "none";
  dateBehavior?: "fiscal_period" | "calendar_date" | "timestamp" | "none";
  freshnessMaxDays?: number;
}

export interface DataContractFamily {
  id: string;
  name: string;
  description: string;
  fields: ContractField[];
}

// ─── Contract Family Definitions ──────────────────────────────────────────

export const CONTRACT_FAMILIES: DataContractFamily[] = [
  {
    id: "company",
    name: "Company",
    description: "Core company identification and classification.",
    fields: [
      { name: "ticker", type: "string", requirement: "required", description: "Primary ticker symbol" },
      { name: "name", type: "string", requirement: "required", description: "Legal or common company name" },
      { name: "exchange", type: "string", requirement: "optional", description: "Primary exchange" },
      { name: "country", type: "string", requirement: "optional", description: "Country of incorporation" },
      { name: "sector", type: "string", requirement: "optional", description: "GICS sector or equivalent" },
      { name: "industry", type: "string", requirement: "optional", description: "GICS industry or equivalent" },
      { name: "currency", type: "string", requirement: "required", description: "Reporting currency (ISO 4217)" },
      { name: "fiscalYearEnd", type: "string", requirement: "optional", description: "Fiscal year end month (e.g. 'December')" },
      { name: "isin", type: "string", requirement: "optional", description: "ISIN identifier" },
      { name: "cusip", type: "string", requirement: "optional", description: "CUSIP identifier" },
    ],
  },
  {
    id: "financial_statements",
    name: "Financial Statements",
    description: "Canonical income statement, balance sheet, and cash flow statement data.",
    fields: financialStatementFields,
  },
  {
    id: "market_data",
    name: "Market Data",
    description: "Current market data: quote, market cap, volume.",
    fields: [
      { name: "price", type: "currency_amount", requirement: "required", description: "Last traded price", currencyBehavior: "specified" },
      { name: "marketCap", type: "currency_amount", requirement: "required", description: "Market capitalization", currencyBehavior: "specified" },
      { name: "volume", type: "integer", requirement: "optional", description: "Trading volume" },
      { name: "sharesOutstanding", type: "integer", requirement: "optional", description: "Shares outstanding" },
      { name: "float", type: "integer", requirement: "optional", description: "Public float" },
      { name: "beta", type: "number", requirement: "optional", description: "Beta (5Y monthly)" },
      { name: "dividendYield", type: "percentage", requirement: "optional", description: "Trailing dividend yield" },
      { name: "peRatio", type: "ratio", requirement: "optional", description: "Trailing P/E ratio" },
      { name: "forwardPeRatio", type: "ratio", requirement: "optional", description: "Forward P/E ratio" },
    ],
  },
  {
    id: "price_history",
    name: "Price History",
    description: "Historical OHLCV price data.",
    fields: [
      { name: "date", type: "date", requirement: "required", description: "Trading date", dateBehavior: "calendar_date" },
      { name: "open", type: "currency_amount", requirement: "required", description: "Open price", currencyBehavior: "specified" },
      { name: "high", type: "currency_amount", requirement: "required", description: "High price", currencyBehavior: "specified" },
      { name: "low", type: "currency_amount", requirement: "required", description: "Low price", currencyBehavior: "specified" },
      { name: "close", type: "currency_amount", requirement: "required", description: "Close price", currencyBehavior: "specified" },
      { name: "adjustedClose", type: "currency_amount", requirement: "optional", description: "Adjusted close (corporate actions)", currencyBehavior: "specified" },
      { name: "volume", type: "integer", requirement: "required", description: "Volume" },
    ],
  },
  {
    id: "estimates",
    name: "Estimates",
    description: "Analyst consensus estimates and revisions.",
    fields: [
      { name: "period", type: "string", requirement: "required", description: "Estimate period", dateBehavior: "fiscal_period" },
      { name: "revenueEstimate", type: "currency_amount", requirement: "optional", description: "Consensus revenue estimate", currencyBehavior: "reporting_currency" },
      { name: "epsEstimate", type: "number", requirement: "optional", description: "Consensus EPS estimate" },
      { name: "ebitdaEstimate", type: "currency_amount", requirement: "optional", description: "Consensus EBITDA estimate", currencyBehavior: "reporting_currency" },
      { name: "analystCount", type: "integer", requirement: "optional", description: "Number of contributing analysts" },
      { name: "consensusDate", type: "date", requirement: "optional", description: "Date of consensus snapshot", dateBehavior: "calendar_date" },
    ],
  },
  {
    id: "ownership",
    name: "Ownership",
    description: "Institutional, insider, and float ownership.",
    fields: [
      { name: "institutionalOwnership", type: "percentage", requirement: "optional", description: "Percentage held by institutions" },
      { name: "insiderOwnership", type: "percentage", requirement: "optional", description: "Percentage held by insiders" },
      { name: "shortInterest", type: "integer", requirement: "optional", description: "Shares sold short" },
      { name: "shortPercentFloat", type: "percentage", requirement: "optional", description: "Short interest as % of float" },
    ],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Portfolio holdings, weights, costs, and constraints.",
    fields: [
      { name: "symbol", type: "string", requirement: "required", description: "Asset identifier" },
      { name: "shares", type: "number", requirement: "required", description: "Number of shares/units held" },
      { name: "costBasis", type: "currency_amount", requirement: "optional", description: "Average cost per share", currencyBehavior: "specified" },
      { name: "weight", type: "percentage", requirement: "optional", description: "Portfolio weight" },
      { name: "assetClass", type: "string", requirement: "optional", description: "Asset class" },
      { name: "sector", type: "string", requirement: "optional", description: "Sector classification" },
    ],
  },
  {
    id: "fixed_income",
    name: "Fixed Income",
    description: "Bond and fixed income instrument data.",
    fields: [
      { name: "issuer", type: "string", requirement: "required", description: "Bond issuer" },
      { name: "coupon", type: "percentage", requirement: "required", description: "Coupon rate" },
      { name: "maturity", type: "date", requirement: "required", description: "Maturity date", dateBehavior: "calendar_date" },
      { name: "faceValue", type: "currency_amount", requirement: "required", description: "Face/par value", currencyBehavior: "specified" },
      { name: "price", type: "number", requirement: "optional", description: "Current market price (per 100)" },
      { name: "yieldToMaturity", type: "percentage", requirement: "optional", description: "Yield to maturity" },
      { name: "dayCount", type: "string", requirement: "optional", description: "Day count convention" },
      { name: "frequency", type: "integer", requirement: "optional", description: "Coupon frequency (times per year)" },
      { name: "rating", type: "string", requirement: "optional", description: "Credit rating" },
      { name: "seniority", type: "string", requirement: "optional", description: "Seniority in capital structure" },
    ],
  },
  {
    id: "derivatives",
    name: "Derivatives",
    description: "Options, futures, and swap instrument data.",
    fields: [
      { name: "underlying", type: "string", requirement: "required", description: "Underlying asset" },
      { name: "instrumentType", type: "string", requirement: "required", description: "option | future | swap" },
      { name: "expiry", type: "date", requirement: "required", description: "Expiration date", dateBehavior: "calendar_date" },
      { name: "strike", type: "currency_amount", requirement: "optional", description: "Strike price (options)", currencyBehavior: "specified" },
      { name: "optionType", type: "string", requirement: "optional", description: "call | put" },
      { name: "impliedVolatility", type: "percentage", requirement: "optional", description: "Implied volatility" },
      { name: "spotPrice", type: "currency_amount", requirement: "optional", description: "Current spot price of underlying", currencyBehavior: "specified" },
      { name: "riskFreeRate", type: "percentage", requirement: "optional", description: "Risk-free rate for pricing" },
      { name: "dividendYield", type: "percentage", requirement: "optional", description: "Dividend yield of underlying" },
    ],
  },
  {
    id: "macro",
    name: "Macro / Economic",
    description: "Macroeconomic indicators and policy data.",
    fields: [
      { name: "country", type: "string", requirement: "required", description: "Country code (ISO 3166)" },
      { name: "indicator", type: "string", requirement: "required", description: "Indicator code (e.g. GDP, CPI)" },
      { name: "value", type: "number", requirement: "required", description: "Indicator value" },
      { name: "date", type: "date", requirement: "required", description: "Observation date", dateBehavior: "calendar_date" },
      { name: "frequency", type: "string", requirement: "optional", description: "Data frequency (daily/weekly/monthly/quarterly/annual)" },
      { name: "unit", type: "string", requirement: "optional", description: "Unit of measure" },
      { name: "source", type: "string", requirement: "optional", description: "Data source identifier" },
      { name: "vintage", type: "string", requirement: "optional", description: "Vintage/revision date" },
    ],
  },
  {
    id: "operations",
    name: "Operations / Supply Chain",
    description: "Operational data for business intelligence.",
    fields: [
      { name: "location", type: "string", requirement: "optional", description: "Location/facility identifier" },
      { name: "inventoryLevel", type: "number", requirement: "optional", description: "Current inventory level" },
      { name: "demandForecast", type: "number", requirement: "optional", description: "Demand forecast" },
      { name: "capacity", type: "number", requirement: "optional", description: "Production capacity" },
      { name: "costPerUnit", type: "currency_amount", requirement: "optional", description: "Cost per unit", currencyBehavior: "specified" },
      { name: "leadTimeDays", type: "integer", requirement: "optional", description: "Lead time in days" },
      { name: "serviceLevel", type: "percentage", requirement: "optional", description: "Service level target" },
    ],
  },
  {
    id: "assumptions",
    name: "Assumptions",
    description: "User-defined or model-derived assumptions for engines.",
    fields: [
      { name: "key", type: "string", requirement: "required", description: "Assumption key (e.g. revenue_growth_rate)" },
      { name: "value", type: "number", requirement: "required", description: "Assumption value" },
      { name: "unit", type: "string", requirement: "optional", description: "Unit (percentage, currency, ratio, etc.)" },
      { name: "rationale", type: "string", requirement: "optional", description: "Why this assumption was chosen" },
      { name: "source", type: "string", requirement: "optional", description: "Source of assumption" },
      { name: "version", type: "integer", requirement: "optional", description: "Assumption version number" },
      { name: "effectiveDate", type: "date", requirement: "optional", description: "When this assumption takes effect", dateBehavior: "calendar_date" },
    ],
  },
  {
    id: "filings",
    name: "Filings / Regulatory",
    description: "Regulatory filings and disclosure documents.",
    fields: [
      { name: "filingType", type: "string", requirement: "required", description: "Filing type (10-K, 10-Q, 8-K, etc.)" },
      { name: "filingDate", type: "date", requirement: "required", description: "Filing date", dateBehavior: "calendar_date" },
      { name: "accessionNumber", type: "string", requirement: "optional", description: "SEC accession number" },
      { name: "url", type: "string", requirement: "optional", description: "Filing URL" },
      { name: "content", type: "string", requirement: "optional", description: "Extracted text content" },
    ],
  },
  {
    id: "transactions",
    name: "Transactions / M&A",
    description: "M&A transactions and precedent comps.",
    fields: [
      { name: "targetName", type: "string", requirement: "required", description: "Target company" },
      { name: "acquirerName", type: "string", requirement: "required", description: "Acquirer company" },
      { name: "announceDate", type: "date", requirement: "required", description: "Announcement date", dateBehavior: "calendar_date" },
      { name: "dealValue", type: "currency_amount", requirement: "optional", description: "Total deal value", currencyBehavior: "specified" },
      { name: "evRevenue", type: "ratio", requirement: "optional", description: "EV/Revenue multiple" },
      { name: "evEbitda", type: "ratio", requirement: "optional", description: "EV/EBITDA multiple" },
      { name: "sector", type: "string", requirement: "optional", description: "Target sector" },
      { name: "geography", type: "string", requirement: "optional", description: "Deal geography" },
    ],
  },
  {
    id: "ai",
    name: "AI / Model",
    description: "AI provider capabilities for optional orchestration.",
    fields: [
      { name: "capability", type: "string", requirement: "required", description: "AI capability (chat, analysis, mapping, etc.)" },
      { name: "provider", type: "string", requirement: "optional", description: "Provider identifier" },
    ],
  },
];

// ─── Engine Contract Declarations ─────────────────────────────────────────

export interface EngineContractDeclaration {
  engineId: string;
  engineName: string;
  /** Required contract families — engine cannot run without these */
  required: string[];
  /** Optional contract families — engine uses if available */
  optional: string[];
  /** Fields within contracts that require manual user input */
  manualInputs?: Array<{ contractFamily: string; field: string; description: string }>;
}

export const ENGINE_CONTRACT_DECLARATIONS: EngineContractDeclaration[] = [
  {
    engineId: "valuation.dcf",
    engineName: "DCF Valuation",
    required: ["financial_statements", "market_data", "assumptions"],
    optional: ["estimates", "company"],
    manualInputs: [
      { contractFamily: "assumptions", field: "revenue_growth_rate", description: "Projected revenue growth rate" },
      { contractFamily: "assumptions", field: "terminal_growth_rate", description: "Terminal growth rate" },
      { contractFamily: "assumptions", field: "wacc", description: "Weighted average cost of capital" },
      { contractFamily: "assumptions", field: "forecast_years", description: "Number of forecast years" },
    ],
  },
  {
    engineId: "valuation.reverse_dcf",
    engineName: "Reverse DCF",
    required: ["market_data", "financial_statements"],
    optional: ["assumptions"],
  },
  {
    engineId: "valuation.lbo",
    engineName: "LBO Model",
    required: ["financial_statements", "market_data", "assumptions"],
    optional: ["fixed_income"],
    manualInputs: [
      { contractFamily: "assumptions", field: "purchase_multiple", description: "Entry EV/EBITDA multiple" },
      { contractFamily: "assumptions", field: "debt_to_equity", description: "Financing leverage ratio" },
      { contractFamily: "assumptions", field: "exit_multiple", description: "Exit EV/EBITDA multiple" },
      { contractFamily: "assumptions", field: "hold_period_years", description: "Investment hold period" },
    ],
  },
  {
    engineId: "valuation.comps",
    engineName: "Trading Comps",
    required: ["market_data", "financial_statements"],
    optional: ["company", "estimates"],
  },
  {
    engineId: "valuation.wacc",
    engineName: "WACC Builder",
    required: ["market_data", "financial_statements"],
    optional: ["assumptions"],
  },
  {
    engineId: "portfolio.optimizer",
    engineName: "Portfolio Optimizer",
    required: ["portfolio", "price_history"],
    optional: ["market_data", "assumptions"],
  },
  {
    engineId: "portfolio.risk",
    engineName: "Portfolio Risk (VaR/CVaR)",
    required: ["portfolio", "price_history"],
    optional: ["market_data"],
  },
  {
    engineId: "fixed_income.bond_pricer",
    engineName: "Bond Pricer",
    required: ["fixed_income"],
    optional: ["macro"],
  },
  {
    engineId: "derivatives.options_greeks",
    engineName: "Options Greeks",
    required: ["derivatives"],
    optional: ["market_data", "price_history"],
  },
  {
    engineId: "macro.dashboard",
    engineName: "Macro Dashboard",
    required: ["macro"],
    optional: [],
  },
  {
    engineId: "operations.inventory",
    engineName: "Inventory Optimization",
    required: ["operations"],
    optional: ["assumptions"],
  },
  {
    engineId: "research.investigation",
    engineName: "Research Investigation",
    required: ["company"],
    optional: ["filings", "financial_statements", "market_data", "estimates", "ai"],
  },
  // ─── Market terminal engines ─────────────────────────────────────────
  {
    engineId: "market.quote_monitor",
    engineName: "Quote Monitor",
    required: ["market_data"],
    optional: ["price_history"],
  },
  {
    engineId: "market.charting",
    engineName: "Technical Charting",
    required: ["price_history"],
    optional: ["market_data"],
  },
  {
    engineId: "market.screener",
    engineName: "Equity Screener",
    required: ["market_data"],
    optional: ["financial_statements", "estimates"],
  },
  {
    engineId: "market.peer_comparison",
    engineName: "Peer Comparison",
    required: ["market_data", "financial_statements"],
    optional: ["estimates", "company"],
  },
  {
    engineId: "market.earnings_analysis",
    engineName: "Earnings Analysis",
    required: ["financial_statements", "estimates"],
    optional: ["market_data", "price_history"],
  },
  {
    engineId: "market.ownership_analysis",
    engineName: "Ownership Analysis",
    required: ["ownership"],
    optional: ["market_data", "company"],
  },
  // ─── Cross-domain engines ──────────────────────────────────────────
  {
    engineId: "macro.shock_analysis",
    engineName: "Macro Shock to Portfolio",
    required: ["macro", "portfolio"],
    optional: ["price_history", "market_data"],
  },
  {
    engineId: "valuation.sotp",
    engineName: "Sum of the Parts",
    required: ["financial_statements", "market_data"],
    optional: ["estimates", "company", "assumptions"],
  },
  {
    engineId: "valuation.sensitivity",
    engineName: "Sensitivity Analysis",
    required: ["assumptions"],
    optional: ["financial_statements", "market_data"],
  },
  // ─── Advanced valuation engines ──────────────────────────────────────
  {
    engineId: "valuation.residual_income",
    engineName: "Residual Income Model",
    required: ["financial_statements", "market_data"],
    optional: ["estimates", "assumptions"],
    manualInputs: [
      { contractFamily: "assumptions", field: "cost_of_equity", description: "Cost of equity (Ke)" },
      { contractFamily: "assumptions", field: "forecast_years", description: "Number of forecast years" },
    ],
  },
  {
    engineId: "valuation.eva",
    engineName: "Economic Value Added (EVA)",
    required: ["financial_statements", "market_data"],
    optional: ["estimates", "assumptions"],
    manualInputs: [
      { contractFamily: "assumptions", field: "wacc", description: "Weighted average cost of capital" },
    ],
  },
  {
    engineId: "valuation.implied_growth",
    engineName: "Implied Growth Analysis",
    required: ["market_data", "financial_statements"],
    optional: ["assumptions"],
  },
  {
    engineId: "valuation.implied_wacc",
    engineName: "Implied WACC",
    required: ["market_data", "financial_statements"],
    optional: ["assumptions"],
  },
  {
    engineId: "valuation.implied_margin",
    engineName: "Implied Operating Margin",
    required: ["market_data", "financial_statements"],
    optional: ["assumptions"],
  },
  {
    engineId: "valuation.bridge",
    engineName: "Valuation Bridge",
    required: ["market_data"],
    optional: ["financial_statements", "estimates", "assumptions"],
  },
  // ─── Portfolio and risk engines ─────────────────────────────────────
  {
    engineId: "portfolio.attribution",
    engineName: "Performance Attribution (Brinson-Fachler)",
    required: ["portfolio", "price_history"],
    optional: ["market_data"],
  },
  {
    engineId: "portfolio.benchmark_relative",
    engineName: "Benchmark-Relative Metrics",
    required: ["portfolio", "price_history"],
    optional: ["market_data"],
  },
  {
    engineId: "portfolio.concentration",
    engineName: "Concentration Risk",
    required: ["portfolio"],
    optional: ["market_data"],
  },
  {
    engineId: "portfolio.rebalancing",
    engineName: "Rebalancing Proposal",
    required: ["portfolio", "market_data"],
    optional: ["assumptions"],
    manualInputs: [
      { contractFamily: "assumptions", field: "target_weights", description: "Target portfolio weights" },
      { contractFamily: "assumptions", field: "drift_threshold", description: "Minimum drift to trigger rebalance" },
    ],
  },
  {
    engineId: "portfolio.factor_exposure",
    engineName: "Factor Exposure Analysis",
    required: ["portfolio", "price_history"],
    optional: ["market_data", "macro"],
  },
  // ─── Fixed income and credit engines ────────────────────────────────
  {
    engineId: "fixed_income.yield_curve",
    engineName: "Yield Curve Construction",
    required: ["fixed_income"],
    optional: ["macro"],
  },
  {
    engineId: "fixed_income.spread_analysis",
    engineName: "Spread Analysis",
    required: ["fixed_income"],
    optional: ["macro", "market_data"],
  },
  {
    engineId: "fixed_income.curve_scenario",
    engineName: "Curve Scenario Engine",
    required: ["fixed_income", "macro"],
    optional: ["assumptions"],
  },
  {
    engineId: "credit.transition_analysis",
    engineName: "Credit Transition Analysis",
    required: ["fixed_income"],
    optional: ["market_data"],
  },
  {
    engineId: "credit.expected_loss",
    engineName: "Expected Loss Model",
    required: ["fixed_income"],
    optional: ["market_data", "assumptions"],
    manualInputs: [
      { contractFamily: "assumptions", field: "probability_of_default", description: "Annual probability of default" },
      { contractFamily: "assumptions", field: "loss_given_default", description: "Loss given default (1 - recovery)" },
    ],
  },
  // ─── Derivatives engines ───────────────────────────────────────────
  {
    engineId: "derivatives.futures_pricing",
    engineName: "Futures Pricing",
    required: ["derivatives", "market_data"],
    optional: ["macro"],
  },
  {
    engineId: "derivatives.term_structure",
    engineName: "Futures Term Structure",
    required: ["derivatives"],
    optional: ["market_data"],
  },
  {
    engineId: "derivatives.swap_valuation",
    engineName: "Interest Rate Swap Valuation",
    required: ["derivatives", "macro"],
    optional: ["fixed_income"],
  },
  {
    engineId: "derivatives.strategy_payoff",
    engineName: "Options Strategy Payoff",
    required: ["derivatives"],
    optional: ["market_data"],
  },
  // ─── Macro and policy engines ───────────────────────────────────────
  {
    engineId: "macro.cross_domain_shock",
    engineName: "Cross-Domain Macro Shock",
    required: ["macro"],
    optional: ["portfolio", "market_data", "price_history"],
  },
  {
    engineId: "macro.country_comparison",
    engineName: "Country Comparison",
    required: ["macro"],
    optional: [],
  },
  {
    engineId: "macro.policy_scenario",
    engineName: "Policy Scenario Analysis",
    required: ["macro"],
    optional: ["assumptions"],
  },
  {
    engineId: "macro.taylor_rule",
    engineName: "Taylor Rule",
    required: ["macro"],
    optional: [],
  },
  {
    engineId: "macro.phillips_curve",
    engineName: "Phillips Curve Regression",
    required: ["macro"],
    optional: [],
  },
  // ─── Operations and supply chain engines ────────────────────────────
  {
    engineId: "operations.capacity_analysis",
    engineName: "Capacity Analysis",
    required: ["operations"],
    optional: [],
  },
  {
    engineId: "operations.cost_to_serve",
    engineName: "Cost-to-Serve Analysis",
    required: ["operations"],
    optional: ["financial_statements"],
  },
  {
    engineId: "operations.supplier_risk",
    engineName: "Supplier Risk Assessment",
    required: ["operations"],
    optional: [],
  },
  {
    engineId: "operations.driver_tree",
    engineName: "Revenue Driver Tree",
    required: ["financial_statements"],
    optional: ["market_data", "assumptions"],
  },
  {
    engineId: "operations.demand_forecast",
    engineName: "Demand Forecasting",
    required: ["operations"],
    optional: ["macro", "price_history"],
  },
  // ─── Research and intelligence engines ──────────────────────────────
  {
    engineId: "research.what_changed",
    engineName: "What Changed Detection",
    required: ["company"],
    optional: ["financial_statements", "market_data", "estimates"],
  },
  {
    engineId: "research.kill_my_thesis",
    engineName: "Kill My Thesis",
    required: ["company"],
    optional: ["financial_statements", "market_data", "filings", "ai"],
  },
  {
    engineId: "research.evidence_scoring",
    engineName: "Evidence Scoring",
    required: ["company"],
    optional: ["filings", "ai"],
  },
  {
    engineId: "research.intelligence_score",
    engineName: "Limuria Intelligence Score",
    required: ["company", "market_data"],
    optional: ["financial_statements", "estimates", "filings"],
  },
];

// ─── Contract Resolver ────────────────────────────────────────────────────

export type ReadinessState = "ready" | "partial" | "blocked" | "manual_input_required" | "not_configured";

export interface ContractReadinessField {
  field: string;
  requirement: ContractFieldRequirement;
  available: boolean;
  source?: string;
}

export interface ContractReadiness {
  contractFamily: string;
  state: ReadinessState;
  availableFields: number;
  requiredFields: number;
  requiredMet: number;
  fields: ContractReadinessField[];
}

export interface EngineReadiness {
  engineId: string;
  engineName: string;
  state: ReadinessState;
  contracts: ContractReadiness[];
  missingRequired: string[];
  manualInputsNeeded: Array<{ contractFamily: string; field: string; description: string }>;
}

/**
 * Resolve engine readiness given available connector capabilities.
 * `availableCapabilities` is a set of contract family IDs that at least
 * one healthy connector can satisfy.
 */
export function resolveEngineReadiness(
  engine: EngineContractDeclaration,
  availableCapabilities: Set<string>,
): EngineReadiness {
  const contracts: ContractReadiness[] = [];
  const missingRequired: string[] = [];

  for (const familyId of engine.required) {
    const family = CONTRACT_FAMILIES.find((f) => f.id === familyId);
    if (!family) {
      missingRequired.push(familyId);
      contracts.push({ contractFamily: familyId, state: "not_configured", availableFields: 0, requiredFields: 0, requiredMet: 0, fields: [] });
      continue;
    }

    const available = availableCapabilities.has(familyId);
    const requiredFields = family.fields.filter((f) => f.requirement === "required");
    const state: ReadinessState = available ? "ready" : "blocked";
    if (!available) missingRequired.push(familyId);

    contracts.push({
      contractFamily: familyId,
      state,
      availableFields: available ? family.fields.length : 0,
      requiredFields: requiredFields.length,
      requiredMet: available ? requiredFields.length : 0,
      fields: family.fields.map((f) => ({
        field: f.name,
        requirement: f.requirement,
        available,
      })),
    });
  }

  for (const familyId of engine.optional) {
    const family = CONTRACT_FAMILIES.find((f) => f.id === familyId);
    const available = availableCapabilities.has(familyId);
    contracts.push({
      contractFamily: familyId,
      state: available ? "ready" : "not_configured",
      availableFields: available && family ? family.fields.length : 0,
      requiredFields: 0,
      requiredMet: 0,
      fields: family?.fields.map((f) => ({ field: f.name, requirement: f.requirement, available })) ?? [],
    });
  }

  const manualInputsNeeded = engine.manualInputs ?? [];
  const hasBlockedRequired = missingRequired.length > 0;
  const needsManualInput = manualInputsNeeded.length > 0 && !hasBlockedRequired;

  let state: ReadinessState;
  if (hasBlockedRequired) state = "blocked";
  else if (needsManualInput) state = "manual_input_required";
  else if (contracts.some((c) => c.state === "not_configured" && engine.optional.includes(c.contractFamily))) state = "partial";
  else state = "ready";

  return { engineId: engine.engineId, engineName: engine.engineName, state, contracts, missingRequired, manualInputsNeeded };
}

/** Resolve readiness for all declared engines at once. */
export function resolveAllEngineReadiness(availableCapabilities: Set<string>): EngineReadiness[] {
  return ENGINE_CONTRACT_DECLARATIONS.map((engine) => resolveEngineReadiness(engine, availableCapabilities));
}

/** Look up a contract family by id. */
export function getContractFamily(id: string): DataContractFamily | undefined {
  return CONTRACT_FAMILIES.find((f) => f.id === id);
}

/** Look up an engine declaration by id. */
export function getEngineDeclaration(engineId: string): EngineContractDeclaration | undefined {
  return ENGINE_CONTRACT_DECLARATIONS.find((e) => e.engineId === engineId);
}
