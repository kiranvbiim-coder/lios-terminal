export interface FinanceKnowledgeVariant {
  id: string;
  label: string;
  formula?: string;
  notes: string;
  useWhen?: string;
}

export interface FinanceKnowledgeConcept {
  id: string;
  label: string;
  domain: string;
  summary: string;
  metricIds: string[];
  variants: FinanceKnowledgeVariant[];
  professionalChecks: string[];
}

/**
 * LiOS Finance Knowledge Canon encodes methodology choices and reconciliation
 * checks, not copyrighted textbook text. It exists so formulas are explicit,
 * comparable and inspectable rather than hidden in UI code.
 */
export const FINANCE_KNOWLEDGE_CANON: readonly FinanceKnowledgeConcept[] = [
  {
    id: "enterprise-value",
    label: "Enterprise Value",
    domain: "Valuation",
    summary: "Value attributable to all operating capital providers, reconciled from equity value and non-equity claims.",
    metricIds: ["marketCap", "enterpriseValue", "enterpriseValueDerived", "grossDebt", "cash", "leaseLiabilities", "preferredStock", "minorityInterest", "unfundedPension", "nonOperatingInvestments"],
    variants: [
      { id: "core", label: "Core EV", formula: "marketCap + grossDebt - cash", notes: "Minimum broadly comparable bridge when detailed claims are unavailable." },
      { id: "institutional", label: "Institutional EV", formula: "marketCap + grossDebt + leaseLiabilities + preferredStock + minorityInterest + unfundedPension - cash - shortTermInvestments - nonOperatingInvestments", notes: "Expanded bridge; each optional claim must be traceable and not double-counted." },
    ],
    professionalChecks: ["Use a consistent date for price, shares and debt/cash.", "Avoid double-counting lease debt or pension claims already included in provider EV.", "Separate operating from genuinely non-operating investments."],
  },
  {
    id: "ebitda",
    label: "EBITDA",
    domain: "Fundamentals",
    summary: "Operating earnings measure before interest, taxes, depreciation and amortization, with reported and analyst-adjusted variants kept distinct.",
    metricIds: ["ebitda", "adjustedEbitda", "ebit", "depreciationAndAmortization", "stockBasedCompensation", "restructuringCharges"],
    variants: [
      { id: "reported", label: "Reported EBITDA", formula: "ebit + depreciationAndAmortization", notes: "Use when provider-reported EBITDA is unavailable and EBIT/D&A reconcile." },
      { id: "adjusted", label: "Adjusted EBITDA", notes: "User/provider adjustments must be itemized; recurring economic costs should not be silently removed." },
    ],
    professionalChecks: ["Reconcile EBITDA to EBIT + D&A where data allows.", "Inspect recurring add-backs across multiple periods.", "Keep stock-based compensation treatment explicit."],
  },
  {
    id: "free-cash-flow",
    label: "Free Cash Flow",
    domain: "Cash Flow",
    summary: "Cash generated after maintaining/growing the operating asset base, with enterprise and equity variants distinguished.",
    metricIds: ["cfo", "capex", "fcf", "fcfDerived", "fcfYield", "fcfConversion"],
    variants: [
      { id: "simple", label: "CFO less Capex", formula: "cfo - abs(capex)", notes: "Simple company FCF proxy suitable for screening and reconciliation." },
      { id: "fcff", label: "FCFF", notes: "Build from NOPAT plus non-cash charges less reinvestment; financing flows excluded." },
      { id: "fcfe", label: "FCFE", notes: "Equity cash flow incorporates net borrowing and financing effects." },
    ],
    professionalChecks: ["Check capex sign convention.", "Separate maintenance and growth capex when known.", "Treat working-capital swings and acquisition spending explicitly."],
  },
  {
    id: "roic",
    label: "Return on Invested Capital",
    domain: "Returns",
    summary: "Operating return generated on capital committed to the business; numerator and invested-capital definitions must remain consistent.",
    metricIds: ["roic", "investedCapital", "investedCapitalDerived", "ebit", "effectiveTaxRate", "wacc", "roicWaccSpread"],
    variants: [
      { id: "nopat-ic", label: "NOPAT / Invested Capital", formula: "ebit * (1 - effectiveTaxRate) / investedCapital", notes: "Primary LiOS convention for corporate operating returns." },
      { id: "average-capital", label: "NOPAT / Average Invested Capital", notes: "Preferred for flow/stock period matching when beginning and ending capital are available." },
    ],
    professionalChecks: ["Use average balance-sheet capital when material intra-year changes exist.", "Align goodwill treatment across peers.", "Compare ROIC with a consistent cost-of-capital framework."],
  },
  {
    id: "relative-valuation",
    label: "Trading Comparables",
    domain: "Valuation",
    summary: "Relative valuation using like-for-like denominators, periods and capital-structure treatment across peers.",
    metricIds: ["pe", "forwardPE", "ps", "pb", "ptbv", "pfcf", "evRevenue", "evEbitda", "evEbitdaNtm", "evEbit"],
    variants: [
      { id: "equity", label: "Equity Multiples", notes: "P/E, P/B, P/TBV, P/FCF compare equity value with equity-claim metrics." },
      { id: "enterprise", label: "Enterprise Multiples", notes: "EV/Revenue, EV/EBITDA and EV/EBIT compare enterprise value with pre-financing operating metrics." },
    ],
    professionalChecks: ["Use the same trailing/forward period for target and peers.", "Normalize accounting and one-off items where comparability matters.", "Bridge enterprise-value multiples to equity value with the target's own net debt and claims."],
  },
  {
    id: "dcf",
    label: "Discounted Cash Flow",
    domain: "Valuation",
    summary: "Intrinsic valuation from forecast cash flows, explicit discount rates and terminal-value assumptions.",
    metricIds: ["revenue", "ebit", "effectiveTaxRate", "depreciationAndAmortization", "capex", "wacc", "grossDebt", "cash"],
    variants: [
      { id: "fcff", label: "FCFF DCF", notes: "Discount unlevered cash flow at WACC to enterprise value, then bridge to equity." },
      { id: "fcfe", label: "FCFE DCF", notes: "Discount equity cash flow at cost of equity directly to equity value." },
      { id: "apv", label: "APV", notes: "Value operations on an unlevered basis and add financing side effects separately." },
    ],
    professionalChecks: ["Terminal growth should be economically sustainable.", "Discount-rate and cash-flow definitions must match.", "Run sensitivity and scenario analysis rather than presenting a single precise point estimate."],
  },
  {
    id: "fixed-income-risk",
    label: "Fixed-Income Risk",
    domain: "Fixed Income",
    summary: "Yield, spread and rate-sensitivity measures used together rather than in isolation.",
    metricIds: ["ytm", "ytw", "zSpread", "oas", "duration", "effectiveDuration", "convexity", "dv01", "carry", "rolldown"],
    variants: [
      { id: "yield", label: "Yield Measures", notes: "YTM assumes promised cash flows/reinvestment; YTW incorporates callability conservatively." },
      { id: "spread", label: "Spread Measures", notes: "Z-spread and OAS distinguish curve spread from embedded-option value." },
      { id: "sensitivity", label: "Sensitivity", notes: "Duration/DV01/convexity summarize first- and second-order rate risk." },
    ],
    professionalChecks: ["Use OAS for securities with material embedded options.", "Apply key-rate or curve shocks when parallel-duration approximations are insufficient.", "Separate carry and rolldown from spread/rate beta."],
  },
  {
    id: "portfolio-risk",
    label: "Portfolio Risk & Performance",
    domain: "Portfolio",
    summary: "Performance, risk, attribution and factor exposure are complementary views of the same portfolio outcome.",
    metricIds: ["twr", "mwr", "sharpe", "sortino", "informationRatio", "trackingError", "activeShare", "var", "cvar", "maxDrawdown", "riskContribution"],
    variants: [
      { id: "performance", label: "Performance", notes: "Use TWR for manager skill independent of external cash flows; MWR/IRR for investor experience." },
      { id: "risk", label: "Risk", notes: "Volatility, drawdown, VaR and expected shortfall describe different loss dimensions." },
      { id: "attribution", label: "Attribution", notes: "Explain return and risk by allocation, selection, factors and positions." },
    ],
    professionalChecks: ["Match benchmark, currency and frequency to the mandate.", "Do not rely on a single risk statistic.", "Backtest and stress assumptions under regime changes and liquidity constraints."],
  },
];

export function getFinanceKnowledgeConcept(id: string): FinanceKnowledgeConcept | null {
  return FINANCE_KNOWLEDGE_CANON.find(concept => concept.id === id) ?? null;
}

export function findKnowledgeForMetric(metricId: string): FinanceKnowledgeConcept[] {
  return FINANCE_KNOWLEDGE_CANON.filter(concept => concept.metricIds.includes(metricId));
}
