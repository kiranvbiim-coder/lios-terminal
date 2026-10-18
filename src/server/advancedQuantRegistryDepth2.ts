import type { QuantModelRegistryEntry } from "@shared/quantModelRegistry";
import type { AdvancedQuantPath } from "./advancedQuantRoutes";

type Depth2Spec = {
  path: AdvancedQuantPath;
  label: string;
  category: string;
  source: string;
  version?: string;
  program?: QuantModelRegistryEntry["program"];
  surface?: string;
};

const specs: Depth2Spec[] = [
  { path: "fixed-income/callable-oas", label: "Callable Bond OAS And Effective Risk", category: "fixed_income", source: "python-service/fixed_income_structured.py", surface: "Fixed Income" },
  { path: "fixed-income/floating-rate-note", label: "Floating Rate Note Analytics", category: "fixed_income", source: "python-service/fixed_income_structured.py", surface: "Fixed Income" },
  { path: "fixed-income/inflation-linked-bond", label: "Inflation Linked Bond Analytics", category: "fixed_income", source: "python-service/fixed_income_structured.py", surface: "Fixed Income" },
  { path: "fixed-income/credit-spread-curve", label: "Credit Spread Curve And Implied Hazard", category: "fixed_income", source: "python-service/fixed_income_structured.py", surface: "Fixed Income" },

  { path: "derivatives/local-volatility", label: "Dupire Local Volatility Surface", category: "derivatives", source: "python-service/derivatives_surface.py", surface: "Quant Workbench" },
  { path: "derivatives/portfolio-greeks", label: "Portfolio Greeks Aggregation", category: "derivatives", source: "python-service/derivatives_surface.py", surface: "Advanced Risk" },
  { path: "derivatives/futures-basis", label: "Futures Basis And Carry", category: "derivatives", source: "python-service/derivatives_surface.py", surface: "Quant Workbench" },
  { path: "derivatives/strategy-payoff", label: "Option Strategy Payoff And Break-Evens", category: "derivatives", source: "python-service/derivatives_surface.py", surface: "Quant Workbench" },

  { path: "portfolio/black-litterman", label: "Black-Litterman Posterior Returns", category: "portfolio_optimization", source: "python-service/portfolio_bayesian.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/bayesian-mean-shrinkage", label: "Bayesian Mean Return Shrinkage", category: "portfolio_optimization", source: "python-service/portfolio_bayesian.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/ledoit-wolf-covariance", label: "Ledoit-Wolf Robust Covariance", category: "portfolio_optimization", source: "python-service/portfolio_bayesian.py", surface: "Portfolio Optimizer" },

  { path: "valuation/real-option", label: "Real Option Valuation", category: "valuation", source: "python-service/valuation_specialized.py", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/expectation-surface", label: "DCF Expectation Surface", category: "valuation", source: "python-service/valuation_specialized.py", version: "1.0.1", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/project-finance", label: "Project Finance NPV IRR DSCR And LLCR", category: "valuation", source: "python-service/valuation_specialized.py", program: "financial_modelling", surface: "Integrated Model Studio" },
  { path: "valuation/saas-cohort", label: "SaaS Cohort LTV CAC And Present Value", category: "valuation", source: "python-service/valuation_specialized.py", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/insurance-embedded-value", label: "Insurance Embedded And Appraised Value", category: "valuation", source: "python-service/valuation_specialized.py", program: "financial_modelling", surface: "Valuation" },
];

export const ADVANCED_QUANT_DEPTH2_REGISTRY: QuantModelRegistryEntry[] = specs.map((spec) => ({
  id: `python.advanced.${spec.path.replaceAll("/", ".")}`,
  label: spec.label,
  category: spec.category,
  program: spec.program ?? "quant_acceleration",
  engine: "python_sidecar",
  status: "implemented",
  validationLevel: "benchmark_required",
  determinism: "deterministic",
  dataMode: "user_supplied",
  version: spec.version ?? "1.0.0",
  apiEndpoint: `/api/quant/advanced/${spec.path}`,
  engineEndpoint: `/advanced/${spec.path}`,
  surfaces: [spec.surface ?? "Quant Workbench", "Quant Lab"],
  components: [spec.label],
  sourceFiles: [spec.source, "python-service/advanced_routes.py", "server/advancedQuantRoutes.ts"],
  references: [],
  limitations: ["Second-wave depth engine is executable and input-validated, but institutional promotion still requires independent golden/reference cases, provenance-bound lineage and domain acceptance evidence."],
  nextValidation: "Promote through known-answer, invariant, challenger/cross-engine, boundary and persisted provenance tests before material-decision use.",
}));
