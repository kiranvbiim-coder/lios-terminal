import { getFinancialMetricDefinition, resolveFinancialMetric, type FinancialMetricObservation } from "./financialMetricRegistry";

export type ValuationMethodFamily = "intrinsic" | "relative" | "transaction" | "asset" | "private-markets" | "sector-specific";

export interface ValuationMethodDefinition {
  id: string;
  label: string;
  family: ValuationMethodFamily;
  description: string;
  requiredMetrics: string[];
  optionalMetrics?: string[];
  sector?: string[];
}

export interface ValuationMethodReadiness {
  method: ValuationMethodDefinition;
  ready: boolean;
  coverage: number;
  available: Array<{ metricId: string; label: string; value: number }>;
  missing: Array<{ metricId: string; label: string }>;
}

export const VALUATION_METHODS: readonly ValuationMethodDefinition[] = [
  { id: "dcf-fcff", label: "DCF — FCFF", family: "intrinsic", description: "Enterprise valuation from unlevered free cash flow discounted at WACC.", requiredMetrics: ["revenue", "ebit", "effectiveTaxRate", "depreciationAndAmortization", "capex", "wacc", "grossDebt", "cash"], optionalMetrics: ["workingCapital", "minorityInterest", "preferredStock", "leaseLiabilities"] },
  { id: "dcf-fcfe", label: "DCF — FCFE", family: "intrinsic", description: "Equity valuation from cash flow available to common equity.", requiredMetrics: ["netIncome", "depreciationAndAmortization", "capex", "dilutedShares"], optionalMetrics: ["grossDebt", "cash"] },
  { id: "apv", label: "Adjusted Present Value", family: "intrinsic", description: "Unlevered enterprise value plus financing side effects.", requiredMetrics: ["ebit", "effectiveTaxRate", "grossDebt"], optionalMetrics: ["wacc", "interestExpense"] },
  { id: "residual-income", label: "Residual Income", family: "intrinsic", description: "Book value plus present value of future excess accounting returns.", requiredMetrics: ["totalEquity", "netIncome", "dilutedShares"], optionalMetrics: ["roe"] },
  { id: "ddm", label: "Dividend Discount Model", family: "intrinsic", description: "Equity value from dividends and required return assumptions.", requiredMetrics: ["dividendPerShare"], optionalMetrics: ["dividendYield", "epsGrowthNtm"] },
  { id: "eva", label: "Economic Value Added", family: "intrinsic", description: "Value creation from returns on invested capital above the cost of capital.", requiredMetrics: ["investedCapital", "roic", "wacc"] },
  { id: "trading-comps", label: "Trading Comparables", family: "relative", description: "Peer-relative valuation using equity and enterprise-value multiples.", requiredMetrics: ["marketCap", "enterpriseValue", "revenue", "ebitda", "ebit", "netIncome"], optionalMetrics: ["evEbitda", "evRevenue", "pe", "pb", "pfcf"] },
  { id: "precedent-transactions", label: "Precedent Transactions", family: "transaction", description: "Transaction-implied multiples and control premiums.", requiredMetrics: ["enterpriseValue", "revenue", "ebitda"], optionalMetrics: ["marketCap"] },
  { id: "sotp", label: "Sum of the Parts", family: "asset", description: "Segment-by-segment valuation with explicit holding-company and net-debt bridge.", requiredMetrics: ["grossDebt", "cash"], optionalMetrics: ["minorityInterest", "preferredStock"] },
  { id: "asset-value", label: "Asset / Liquidation Value", family: "asset", description: "Asset-based valuation with explicit recovery assumptions.", requiredMetrics: ["totalAssets", "totalLiabilities"], optionalMetrics: ["cash", "inventory", "receivables", "ppe", "goodwill", "intangibles"] },
  { id: "lbo", label: "Leveraged Buyout", family: "private-markets", description: "Entry/exit valuation, leverage, debt paydown, MOIC and IRR framework.", requiredMetrics: ["ebitda", "fcf", "grossDebt", "cash"], optionalMetrics: ["capex", "cfo", "interestExpense"] },
  { id: "venture", label: "Venture Capital Method", family: "private-markets", description: "Exit-value and required-return based private-company valuation.", requiredMetrics: ["revenue"], optionalMetrics: ["revenueNtm", "ebitdaNtm"] },
  { id: "bank-excess-return", label: "Bank Excess Return / P-TBV", family: "sector-specific", description: "Bank valuation centered on tangible equity, returns and capital strength.", requiredMetrics: ["tangibleBookValue", "roe", "bank.cet1"], optionalMetrics: ["bank.nim", "bank.costOfRisk", "ptbv"], sector: ["banks", "banking"] },
  { id: "reit-nav", label: "REIT NAV / Cap Rate", family: "sector-specific", description: "Property-level NAV using NOI, cap rates and net debt.", requiredMetrics: ["reit.noi", "reit.capRate", "netDebt"], optionalMetrics: ["reit.occupancy", "reit.ffo", "reit.affo"], sector: ["reit", "real estate"] },
  { id: "insurance-embedded-value", label: "Insurance Embedded Value", family: "sector-specific", description: "Embedded-value framework incorporating value of new business and solvency.", requiredMetrics: ["insurance.embeddedValue", "insurance.vnb"], optionalMetrics: ["insurance.solvency", "insurance.gwp"], sector: ["insurance"] },
];

export function assessValuationMethodReadiness(method: ValuationMethodDefinition, observations: readonly FinancialMetricObservation[]): ValuationMethodReadiness {
  const available: ValuationMethodReadiness["available"] = [];
  const missing: ValuationMethodReadiness["missing"] = [];
  for (const metricId of method.requiredMetrics) {
    const resolved = resolveFinancialMetric(metricId, observations);
    const definition = getFinancialMetricDefinition(metricId);
    if (typeof resolved?.value === "number" && Number.isFinite(resolved.value)) available.push({ metricId, label: definition?.label ?? metricId, value: resolved.value });
    else missing.push({ metricId, label: definition?.label ?? metricId });
  }
  const coverage = method.requiredMetrics.length ? available.length / method.requiredMetrics.length : 1;
  return { method, ready: missing.length === 0, coverage, available, missing };
}

export function rankValuationMethods(observations: readonly FinancialMetricObservation[], sectorText = ""): ValuationMethodReadiness[] {
  const sector = sectorText.toLowerCase();
  return VALUATION_METHODS
    .filter(method => !method.sector?.length || method.sector.some(item => sector.includes(item)))
    .map(method => assessValuationMethodReadiness(method, observations))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || b.coverage - a.coverage || a.method.label.localeCompare(b.method.label));
}
