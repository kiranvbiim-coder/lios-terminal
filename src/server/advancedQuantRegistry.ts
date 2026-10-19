import type { QuantModelRegistryEntry } from "@shared/quantModelRegistry";
import type { AdvancedQuantPath } from "./advancedQuantRoutes";

export type AdvancedModelSpec = {
  path: AdvancedQuantPath;
  label: string;
  category: string;
  source: string;
  version?: string;
  determinism?: QuantModelRegistryEntry["determinism"];
  program?: QuantModelRegistryEntry["program"];
  surface?: string;
  validationLevel?: QuantModelRegistryEntry["validationLevel"];
  evidenceFiles?: string[];
  limitations?: string[];
  nextValidation?: string;
};

const specs: AdvancedModelSpec[] = [
  { path: "fixed-income/bootstrap-par-curve", label: "Par Curve Bootstrap", category: "fixed_income", source: "python-service/advanced_fixed_income.py", surface: "Yield Curve" },
  { path: "fixed-income/spread-analytics", label: "Z-Spread And Spread Duration", category: "fixed_income", source: "python-service/advanced_fixed_income.py", surface: "Fixed Income" },
  { path: "fixed-income/key-rate-risk", label: "Key-Rate Duration And DV01", category: "fixed_income", source: "python-service/advanced_fixed_income.py", surface: "Fixed Income" },
  { path: "fixed-income/immunize-duration", label: "Duration Immunisation", category: "fixed_income", source: "python-service/advanced_fixed_income.py", surface: "Fixed Income" },

  { path: "derivatives/black-scholes-greeks", label: "Black-Scholes Higher Greeks", category: "derivatives", source: "python-service/advanced_derivatives.py", version: "1.0.1", surface: "Quant Workbench" },
  { path: "derivatives/implied-volatility", label: "Implied Volatility Inversion", category: "derivatives", source: "python-service/advanced_derivatives.py", surface: "Quant Workbench" },
  { path: "derivatives/surface-arbitrage", label: "Volatility Surface Arbitrage Diagnostics", category: "derivatives", source: "python-service/advanced_derivatives.py", surface: "Quant Workbench" },
  { path: "derivatives/exotic-monte-carlo", label: "Seeded Exotic Option Monte Carlo", category: "derivatives", source: "python-service/advanced_derivatives.py", determinism: "seeded_stochastic", surface: "Monte Carlo" },
  { path: "derivatives/interest-rate-swap", label: "Interest Rate Swap Analytics", category: "derivatives", source: "python-service/advanced_derivatives.py", surface: "Fixed Income" },
  { path: "derivatives/black-swaption", label: "Black Swaption Pricing", category: "derivatives", source: "python-service/advanced_derivatives.py", surface: "Fixed Income" },

  { path: "portfolio/hrp", label: "Hierarchical Risk Parity", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/risk-budget", label: "Custom Risk Budget Optimisation", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/factor-risk", label: "Factor Risk Optimisation", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/tracking-error", label: "Tracking Error Optimisation", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/tax-aware-rebalance", label: "Tax-Aware Rebalancing", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Portfolio Optimizer" },
  { path: "portfolio/stress-aware", label: "Stress-Aware Portfolio Optimisation", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Portfolio Stress" },
  { path: "portfolio/regime-blend", label: "Regime-Conditioned Portfolio Blend", category: "portfolio_optimization", source: "python-service/advanced_portfolio.py", surface: "Regime Classifier" },

  { path: "valuation/probabilistic-dcf", label: "Probabilistic Monte Carlo DCF", category: "valuation", source: "python-service/advanced_valuation.py", version: "1.0.1", determinism: "seeded_stochastic", program: "financial_modelling", surface: "Valuation" },
  {
    path: "valuation/dcf-sensitivity",
    label: "Deterministic DCF Sensitivity",
    category: "valuation",
    source: "python-service/advanced_valuation.py",
    program: "financial_modelling",
    surface: "Valuation",
    validationLevel: "known_answer",
    evidenceFiles: [
      "python-service/fixtures/dcf_sensitivity_known_answers.json",
      "python-service/test_dcf_sensitivity_known_answers.py",
    ],
    limitations: [
      "Uses explicit user-supplied free cash flows and year-end discounting; it does not infer forecast cash flows, WACC, terminal growth, exit multiples, net debt or shares.",
      "The WACC × terminal-growth grid always uses the Gordon-growth terminal method; exit-multiple cases require an explicit terminal metric.",
    ],
    nextValidation: "Maintain the known-answer corpus and reconcile convention changes against the institutional DCF implementation before altering this contract.",
  },
  { path: "valuation/reverse-dcf", label: "Reverse DCF Expectations", category: "valuation", source: "python-service/advanced_valuation.py", version: "1.0.1", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/residual-income", label: "Residual Income Valuation", category: "valuation", source: "python-service/advanced_valuation.py", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/eva", label: "Economic Value Added Valuation", category: "valuation", source: "python-service/advanced_valuation.py", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/sotp", label: "Sum-Of-The-Parts Valuation", category: "valuation", source: "python-service/advanced_valuation.py", program: "financial_modelling", surface: "Valuation" },
  { path: "valuation/merger-accretion", label: "Merger Accretion Dilution And Break-Even Synergy", category: "valuation", source: "python-service/advanced_valuation.py", program: "financial_modelling", surface: "M&A Deal Desk" },

  { path: "credit/merton", label: "Merton Structural Credit Model", category: "credit_risk", source: "python-service/advanced_credit.py", surface: "Advanced Risk" },
  { path: "credit/rating-migration", label: "Rating Migration Matrix", category: "credit_risk", source: "python-service/advanced_credit.py", surface: "Advanced Risk" },
  { path: "credit/creditmetrics", label: "CreditMetrics Portfolio Simulation", category: "credit_risk", source: "python-service/advanced_credit.py", determinism: "seeded_stochastic", surface: "Advanced Risk" },
  { path: "credit/stress-pd", label: "Macro-Stressed Probability Of Default", category: "credit_risk", source: "python-service/advanced_credit.py", surface: "Advanced Risk" },
  { path: "credit/covenant-headroom", label: "Debt Covenant Headroom", category: "credit_risk", source: "python-service/advanced_credit.py", surface: "Advanced Risk" },

  { path: "econometrics/weak-instruments", label: "Weak Instrument Diagnostics", category: "econometrics", source: "python-service/advanced_econometrics.py" },
  { path: "econometrics/event-study", label: "Event Study", category: "econometrics", source: "python-service/advanced_econometrics.py" },
  { path: "econometrics/synthetic-control", label: "Synthetic Control", category: "econometrics", source: "python-service/advanced_econometrics.py" },
  { path: "econometrics/propensity-match", label: "Propensity Score Matching", category: "econometrics", source: "python-service/advanced_econometrics.py" },
  { path: "econometrics/local-projections", label: "Local Projection Impulse Responses", category: "econometrics", source: "python-service/advanced_econometrics.py" },
  { path: "econometrics/bayesian-var", label: "Regularised Bayesian VAR", category: "econometrics", source: "python-service/advanced_econometrics.py" },

  { path: "forecasting/model-tournament", label: "Rolling Forecast Model Tournament", category: "forecasting", source: "python-service/advanced_forecasting.py" },
  { path: "forecasting/probabilistic-ar1", label: "Probabilistic AR Forecast", category: "forecasting", source: "python-service/advanced_forecasting.py", determinism: "seeded_stochastic" },
  { path: "forecasting/reconcile-hierarchy", label: "Hierarchical Forecast Reconciliation", category: "forecasting", source: "python-service/advanced_forecasting.py" },
  { path: "forecasting/nowcast", label: "Indicator Nowcasting", category: "forecasting", source: "python-service/advanced_forecasting.py" },
  { path: "forecasting/regime-conditioned", label: "Regime-Conditioned Forecast", category: "forecasting", source: "python-service/advanced_forecasting.py" },

  { path: "risk/tail-report", label: "Institutional Tail Risk Report", category: "risk", source: "python-service/advanced_risk.py", determinism: "seeded_stochastic", surface: "Advanced Risk" },
  { path: "risk/liquidity-var", label: "Liquidity-Adjusted VaR", category: "risk", source: "python-service/advanced_risk.py", surface: "Advanced Risk" },
  { path: "risk/reverse-stress", label: "Reverse Stress Test", category: "risk", source: "python-service/advanced_risk.py", surface: "Portfolio Stress" },
  { path: "risk/correlation-breakdown", label: "Correlation Breakdown Stress", category: "risk", source: "python-service/advanced_risk.py", surface: "Portfolio Stress" },

  { path: "supply-chain/facility-location", label: "Facility Location MILP", category: "supply_chain", source: "python-service/advanced_supply_chain.py", surface: "Supply Chain Quant" },
  { path: "supply-chain/stochastic-inventory", label: "Stochastic Inventory Optimisation", category: "supply_chain", source: "python-service/advanced_supply_chain.py", surface: "Supply Chain Quant" },
  { path: "supply-chain/supplier-portfolio", label: "Supplier Portfolio Optimisation", category: "supply_chain", source: "python-service/advanced_supply_chain.py", surface: "Supply Chain Quant" },
  { path: "supply-chain/disruption-simulation", label: "Supply Disruption Simulation", category: "supply_chain", source: "python-service/advanced_supply_chain.py", determinism: "seeded_stochastic", surface: "Supply Chain Quant" },
  { path: "supply-chain/resilience-frontier", label: "Supply Resilience Frontier", category: "supply_chain", source: "python-service/advanced_supply_chain.py", surface: "Supply Chain Quant" },

  { path: "climate/financed-emissions", label: "Financed Emissions", category: "climate", source: "python-service/advanced_climate.py", surface: "Environment Quant" },
  { path: "climate/climate-var", label: "Climate Value At Risk", category: "climate", source: "python-service/advanced_climate.py", surface: "Environment Quant" },
  { path: "climate/abatement-curve", label: "Marginal Abatement Cost Curve", category: "climate", source: "python-service/advanced_climate.py", surface: "Environment Quant" },
  { path: "climate/transition-pathway", label: "Climate Transition Pathway", category: "climate", source: "python-service/advanced_climate.py", surface: "Environment Quant" },

  { path: "macro/yield-curve-signals", label: "Yield Curve Macro Signals", category: "macro", source: "python-service/advanced_macro.py", surface: "Macro And Rates Data Fabric" },
  { path: "macro/financial-conditions-index", label: "Financial Conditions Index", category: "macro", source: "python-service/advanced_macro.py", surface: "Macro And Rates Data Fabric" },
  { path: "macro/recession-probability", label: "Recession Probability Model", category: "macro", source: "python-service/advanced_macro.py", surface: "Macro And Rates Data Fabric" },
  { path: "macro/inflation-decomposition", label: "Inflation Decomposition", category: "macro", source: "python-service/advanced_macro.py", surface: "Macro And Rates Data Fabric" },
  { path: "macro/company-transmission", label: "Macro To Company Transmission", category: "macro", source: "python-service/advanced_macro.py", surface: "Macro And Rates Data Fabric" },
  { path: "macro/fiscal-multiplier", label: "Fiscal Multiplier Scenario", category: "macro", source: "python-service/advanced_macro.py", surface: "Economics And Policy Quant" },

  { path: "research/evidence-graph", label: "Evidence Graph", category: "research_intelligence", source: "python-service/advanced_research.py", surface: "Research Intelligence" },
  { path: "research/filing-diff", label: "Filing Difference Intelligence", category: "research_intelligence", source: "python-service/advanced_research.py", surface: "Research Intelligence" },
  { path: "research/consensus-divergence", label: "Consensus Divergence And Expectation Gap", category: "research_intelligence", source: "python-service/advanced_research.py", surface: "Consensus And Variant Perception" },
  { path: "research/catalyst-monitor", label: "Catalyst Monitor", category: "research_intelligence", source: "python-service/advanced_research.py", surface: "Research Intelligence" },

  { path: "financial-modeling/three-statement", label: "Integrated Three Statement Model", category: "financial_modelling", source: "python-service/advanced_financial_modeling.py", program: "financial_modelling", surface: "Integrated Model Studio" },

  { path: "decision/model-tournament", label: "Decision Model Tournament", category: "decision_intelligence", source: "python-service/decision_supercomputer.py", surface: "Decision Engine" },
  { path: "decision/scenario-graph", label: "Cross-Domain Scenario Propagation", category: "decision_intelligence", source: "python-service/decision_supercomputer.py", surface: "Decision Engine" },
  { path: "decision/uncertainty", label: "Uncertainty Decomposition", category: "decision_intelligence", source: "python-service/decision_supercomputer.py", surface: "Decision Engine" },
  { path: "decision/value-of-information", label: "Value Of Information And Minimax Regret", category: "decision_intelligence", source: "python-service/decision_supercomputer.py", surface: "Decision Engine" },
  { path: "decision/mcda", label: "Multi-Criteria Decision Analysis", category: "decision_intelligence", source: "python-service/decision_supercomputer.py", surface: "Decision Engine" },
];

export const ADVANCED_QUANT_REGISTRY: QuantModelRegistryEntry[] = specs.map((spec) => ({
  id: `python.advanced.${spec.path.replaceAll("/", ".")}`,
  label: spec.label,
  category: spec.category,
  program: spec.program ?? "quant_acceleration",
  engine: "python_sidecar",
  status: "implemented",
  validationLevel: spec.validationLevel ?? "benchmark_required",
  determinism: spec.determinism ?? "deterministic",
  dataMode: "user_supplied",
  version: spec.version ?? "1.0.0",
  apiEndpoint: `/api/quant/advanced/${spec.path}`,
  engineEndpoint: `/advanced/${spec.path}`,
  surfaces: [spec.surface ?? "Quant Workbench", "Quant Lab"],
  components: [spec.label],
  sourceFiles: [spec.source, "python-service/advanced_routes.py", "server/advancedQuantRoutes.ts", ...(spec.evidenceFiles ?? [])],
  references: [],
  limitations: spec.limitations ?? ["Advanced engine is executable and input-validated, but institutional promotion still requires independent golden/reference cases, provenance-bound run lineage and domain-specific acceptance evidence."],
  nextValidation: spec.nextValidation ?? "Promote through known-answer, invariant, challenger/cross-engine, boundary and persisted provenance tests before material-decision use.",
}));
