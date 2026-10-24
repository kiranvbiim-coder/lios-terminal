"""Canonical numerical route declarations shared by HTTP and isolated execution.

Names below are migrated from the existing typed HTTP routes. Only an allowlisted
route can select a module; importing this manifest never imports numerical packs.
"""
from __future__ import annotations

import importlib
import math
import sys
from typing import NamedTuple

from pydantic import ValidationError


class EngineRoute(NamedTuple):
    path: str
    module: str
    request_model: str
    response_model: str
    function: str


BASE_ROUTES = (
    EngineRoute('/fixed-income/bond-price', 'fixed_income', 'BondPriceRequest', 'BondPriceResponse', 'price_bond'),
    EngineRoute('/portfolio/min-variance', 'portfolio_optimization', 'MeanVarianceRequest', 'WeightsResponse', 'min_variance'),
    EngineRoute('/portfolio/max-sharpe', 'portfolio_optimization', 'MaxSharpeRequest', 'WeightsResponse', 'max_sharpe'),
    EngineRoute('/portfolio/efficient-frontier', 'portfolio_optimization', 'EfficientFrontierRequest', 'EfficientFrontierResponse', 'efficient_frontier'),
    EngineRoute('/portfolio/risk-parity', 'portfolio_optimization', 'CovOnlyRequest', 'WeightsResponse', 'risk_parity'),
    EngineRoute('/portfolio/max-diversification', 'portfolio_optimization', 'MaxDiversificationRequest', 'WeightsResponse', 'max_diversification'),
    EngineRoute('/portfolio/mean-cvar', 'portfolio_optimization', 'MeanCVaRRequest', 'MeanCVaRResponse', 'mean_cvar_optimization'),
    EngineRoute('/credit/credit-var', 'credit_operational_risk', 'CreditVarRequest', 'CreditVarResponse', 'credit_var'),
    EngineRoute('/credit/operational-risk-lda', 'credit_operational_risk', 'OperationalRiskRequest', 'OperationalRiskResponse', 'operational_risk_lda'),
    EngineRoute('/stats/normality', 'statistics_econometrics', 'NormalityRequest', 'NormalityResponse', 'normality_tests'),
    EngineRoute('/stats/hypothesis-tests', 'statistics_econometrics', 'HypothesisTestRequest', 'HypothesisTestResponse', 'hypothesis_tests'),
    EngineRoute('/stats/correlation', 'statistics_econometrics', 'CorrelationRequest', 'CorrelationResponse', 'correlation_analysis'),
    EngineRoute('/stats/partial-correlation', 'statistics_econometrics', 'PartialCorrelationRequest', 'PartialCorrelationResponse', 'partial_correlation'),
    EngineRoute('/stats/ols-diagnostics', 'statistics_econometrics', 'RegressionRequest', 'RegressionResponse', 'ols_diagnostics'),
    EngineRoute('/stats/gls', 'statistics_econometrics', 'WeightedRegressionRequest', 'RegressionResponse', 'gls_regression'),
    EngineRoute('/stats/logistic', 'statistics_econometrics', 'RegressionRequest', 'BinaryRegressionResponse', 'logistic_regression'),
    EngineRoute('/stats/probit', 'statistics_econometrics', 'RegressionRequest', 'BinaryRegressionResponse', 'probit_regression'),
    EngineRoute('/stats/robust-regression', 'statistics_econometrics', 'RobustRegressionRequest', 'RobustRegressionResponse', 'robust_regression'),
    EngineRoute('/stats/influence-diagnostics', 'statistics_econometrics', 'RegressionRequest', 'InfluenceDiagnosticsResponse', 'influence_diagnostics'),
    EngineRoute('/stats/vif', 'statistics_econometrics', 'VifRequest', 'VifResponse', 'variance_inflation_factors'),
    EngineRoute('/stats/reset-test', 'statistics_econometrics', 'RegressionRequest', 'ResetTestResponse', 'reset_test'),
    EngineRoute('/stats/autocorrelation-tests', 'statistics_econometrics', 'AutocorrelationTestRequest', 'AutocorrelationTestResponse', 'autocorrelation_tests'),
    EngineRoute('/stats/descriptive-diagnostics', 'professional_statistics', 'DescriptiveRequest', 'StatisticsResponse', 'descriptive_diagnostics'),
    EngineRoute('/stats/distribution-fit', 'professional_statistics', 'DistributionFitRequest', 'StatisticsResponse', 'distribution_fit'),
    EngineRoute('/stats/professional-inference', 'professional_statistics', 'InferenceRequest', 'StatisticsResponse', 'professional_inference'),
    EngineRoute('/stats/seeded-resampling', 'professional_statistics', 'ResamplingRequest', 'StatisticsResponse', 'seeded_resampling'),
    EngineRoute('/stats/multiple-testing', 'professional_statistics', 'MultipleTestingRequest', 'StatisticsResponse', 'multiple_testing'),
    EngineRoute('/stats/multivariate-structure', 'professional_statistics', 'MultivariateRequest', 'StatisticsResponse', 'multivariate_structure'),
    EngineRoute('/stats/bayesian-normal', 'professional_statistics', 'BayesianNormalRequest', 'StatisticsResponse', 'bayesian_normal'),
    EngineRoute('/econometrics/panel-ols', 'econometrics', 'PanelOlsRequest', 'PanelOlsResponse', 'panel_ols'),
    EngineRoute('/econometrics/iv-2sls', 'econometrics', 'Iv2SlsRequest', 'Iv2SlsResponse', 'iv_2sls'),
    EngineRoute('/econometrics/did', 'econometrics', 'DidRequest', 'DidResponse', 'difference_in_differences'),
    EngineRoute('/econometrics/rd', 'econometrics', 'RdRequest', 'RdResponse', 'regression_discontinuity'),
    EngineRoute('/econometrics/var', 'econometrics', 'VarRequest', 'VarResponse', 'var_model'),
    EngineRoute('/econometrics/vecm', 'econometrics', 'VecmRequest', 'VecmResponse', 'vecm_model'),
    EngineRoute('/econometrics/granger', 'econometrics', 'GrangerRequest', 'GrangerResponse', 'granger_causality'),
    EngineRoute('/econometrics/johansen', 'econometrics', 'JohansenRequest', 'JohansenResponse', 'johansen_cointegration'),
    EngineRoute('/econometrics/unit-root', 'econometrics', 'UnitRootRequest', 'UnitRootResponse', 'unit_root_tests'),
    EngineRoute('/econometrics/heteroskedasticity', 'econometrics', 'HeteroskedasticityRequest', 'HeteroskedasticityResponse', 'heteroskedasticity_tests'),
    EngineRoute('/econometrics/quantile-regression', 'econometrics', 'QuantileRegressionRequest', 'QuantileRegressionResponse', 'quantile_regression'),
    EngineRoute('/econometrics/sur', 'econometrics', 'SurRequest', 'SurResponse', 'seemingly_unrelated_regression'),
    EngineRoute('/econometrics/mixed-effects-panel', 'econometrics', 'MixedEffectsRequest', 'MixedEffectsResponse', 'mixed_effects_panel'),
    EngineRoute('/options/sabr-calibrate', 'options_volatility', 'SabrCalibrateRequest', 'SabrCalibrateResponse', 'sabr_calibrate'),
    EngineRoute('/options/sabr-smile', 'options_volatility', 'SabrSmileRequest', 'SabrSmileResponse', 'sabr_smile'),
    EngineRoute('/options/heston-calibrate', 'options_volatility', 'HestonCalibrateRequest', 'HestonCalibrateResponse', 'heston_calibrate'),
    EngineRoute('/options/heston-price', 'options_volatility', 'HestonPriceRequest', 'HestonPriceResponse', 'heston_price'),
    EngineRoute('/forecasting/sarimax', 'forecasting', 'SarimaxRequest', 'SarimaxResponse', 'sarimax_forecast'),
    EngineRoute('/forecasting/stl', 'forecasting', 'StlRequest', 'StlResponse', 'stl_decompose'),
    EngineRoute('/forecasting/changepoint', 'forecasting', 'ChangepointRequest', 'ChangepointResponse', 'changepoint_detect'),
    EngineRoute('/forecasting/garch', 'forecasting', 'GarchRequest', 'GarchResponse', 'garch_fit'),
    EngineRoute('/economics/leontief-io', 'economics_policy', 'LeontiefRequest', 'LeontiefResponse', 'leontief_io'),
    EngineRoute('/economics/taylor-rule', 'economics_policy', 'TaylorRuleRequest', 'TaylorRuleResponse', 'taylor_rule'),
    EngineRoute('/economics/phillips-curve', 'economics_policy', 'PhillipsCurveRequest', 'PhillipsCurveResponse', 'phillips_curve'),
    EngineRoute('/economics/gini', 'economics_policy', 'GiniRequest', 'GiniResponse', 'gini_coefficient'),
    EngineRoute('/economics/income-tax-microsim', 'economics_policy', 'IncomeTaxMicrosimRequest', 'IncomeTaxMicrosimResponse', 'income_tax_microsim'),
    EngineRoute('/economics/carbon-tax-dividend', 'economics_policy', 'CarbonTaxDividendRequest', 'CarbonTaxDividendResponse', 'carbon_tax_dividend'),
    EngineRoute('/ml/classification', 'ml_cluster', 'ClassificationRequest', 'ClassificationResponse', 'classification_pipeline'),
    EngineRoute('/ml/regression', 'ml_cluster', 'RegressionRequest', 'MLRegressionResponse', 'regression_pipeline'),
    EngineRoute('/ml/clustering', 'ml_cluster', 'ClusteringRequest', 'ClusteringResponse', 'clustering_pipeline'),
    EngineRoute('/ml/anomaly-detection', 'ml_cluster', 'AnomalyDetectionRequest', 'AnomalyDetectionResponse', 'anomaly_detection'),
    EngineRoute('/supplychain/route-optimization', 'supply_chain', 'TspRequest', 'TspResponse', 'solve_tsp_2opt'),
    EngineRoute('/supplychain/safety-stock', 'supply_chain', 'SafetyStockRequest', 'SafetyStockResponse', 'multi_echelon_safety_stock'),
    EngineRoute('/supplychain/bullwhip', 'supply_chain', 'BullwhipRequest', 'BullwhipResponse', 'compute_bullwhip_effect'),
    EngineRoute('/supplychain/network-analysis', 'supply_chain', 'NetworkAnalysisRequest', 'NetworkAnalysisResponse', 'network_analysis'),
    EngineRoute('/supplychain/resilience', 'supply_chain', 'ResilienceRequest', 'ResilienceResponse', 'supply_chain_resilience_index'),
    EngineRoute('/environment/climate-transition-risk', 'environment', 'ClimateTransitionRiskRequest', 'ClimateTransitionRiskResponse', 'climate_transition_risk'),
    EngineRoute('/environment/carbon-credit-mrv', 'environment', 'CarbonCreditMrvRequest', 'CarbonCreditMrvResponse', 'carbon_credit_mrv_valuation'),
    EngineRoute('/optimization/genetic-algorithm', 'optimization_engine', 'GeneticAlgorithmRequest', 'GeneticAlgorithmResponse', 'genetic_algorithm'),
    EngineRoute('/optimization/stochastic', 'optimization_engine', 'StochasticOptimizationRequest', 'StochasticOptimizationResponse', 'stochastic_optimization'),
    EngineRoute('/optimization/multi-objective', 'optimization_engine', 'MultiObjectiveRequest', 'MultiObjectiveResponse', 'multi_objective_optimization'),
    EngineRoute('/optimization/sensitivity-analysis', 'optimization_engine', 'SensitivityAnalysisRequest', 'SensitivityAnalysisResponse', 'sensitivity_analysis'),
    EngineRoute('/sec/filing-search', 'sec_search', 'FilingSearchRequest', 'FilingSearchResponse', 'search_filings'),
)

ADVANCED_ROUTES = (
    EngineRoute('/fixed-income/bootstrap-par-curve', 'advanced_fixed_income', 'BootstrapCurveRequest', 'BootstrapCurveResponse', 'bootstrap_par_curve'),
    EngineRoute('/fixed-income/spread-analytics', 'advanced_fixed_income', 'SpreadAnalyticsRequest', 'SpreadAnalyticsResponse', 'spread_analytics'),
    EngineRoute('/fixed-income/key-rate-risk', 'advanced_fixed_income', 'KeyRateRiskRequest', 'KeyRateRiskResponse', 'key_rate_risk'),
    EngineRoute('/fixed-income/immunize-duration', 'advanced_fixed_income', 'ImmunizationRequest', 'ImmunizationResponse', 'immunize_duration'),
    EngineRoute('/fixed-income/callable-oas', 'fixed_income_structured', 'CallableBondOasRequest', 'CallableBondOasResponse', 'callable_bond_oas'),
    EngineRoute('/fixed-income/floating-rate-note', 'fixed_income_structured', 'FloatingRateNoteRequest', 'FloatingRateNoteResponse', 'floating_rate_note'),
    EngineRoute('/fixed-income/inflation-linked-bond', 'fixed_income_structured', 'InflationLinkedBondRequest', 'InflationLinkedBondResponse', 'inflation_linked_bond'),
    EngineRoute('/fixed-income/credit-spread-curve', 'fixed_income_structured', 'CreditSpreadCurveRequest', 'CreditSpreadCurveResponse', 'credit_spread_curve'),
    EngineRoute('/derivatives/black-scholes-greeks', 'advanced_derivatives', 'BlackScholesRequest', 'GreeksResponse', 'black_scholes_greeks'),
    EngineRoute('/derivatives/implied-volatility', 'advanced_derivatives', 'ImpliedVolRequest', 'ImpliedVolResponse', 'implied_volatility'),
    EngineRoute('/derivatives/surface-arbitrage', 'advanced_derivatives', 'VolSurfaceCheckRequest', 'VolSurfaceCheckResponse', 'check_vol_surface_arbitrage'),
    EngineRoute('/derivatives/exotic-monte-carlo', 'advanced_derivatives', 'ExoticMonteCarloRequest', 'ExoticMonteCarloResponse', 'exotic_monte_carlo'),
    EngineRoute('/derivatives/interest-rate-swap', 'advanced_derivatives', 'SwapRequest', 'SwapResponse', 'interest_rate_swap'),
    EngineRoute('/derivatives/black-swaption', 'advanced_derivatives', 'SwaptionRequest', 'SwaptionResponse', 'black_swaption'),
    EngineRoute('/derivatives/local-volatility', 'derivatives_surface', 'LocalVolRequest', 'LocalVolResponse', 'dupire_local_vol'),
    EngineRoute('/derivatives/portfolio-greeks', 'derivatives_surface', 'PortfolioGreeksRequest', 'PortfolioGreeksResponse', 'portfolio_greeks'),
    EngineRoute('/derivatives/futures-basis', 'derivatives_surface', 'FuturesBasisRequest', 'FuturesBasisResponse', 'futures_basis'),
    EngineRoute('/derivatives/strategy-payoff', 'derivatives_surface', 'OptionStrategyRequest', 'OptionStrategyResponse', 'option_strategy_payoff'),
    EngineRoute('/portfolio/hrp', 'advanced_portfolio', 'HrpRequest', 'WeightsResponse', 'hierarchical_risk_parity'),
    EngineRoute('/portfolio/risk-budget', 'advanced_portfolio', 'RiskBudgetRequest', 'RiskBudgetResponse', 'risk_budget_optimization'),
    EngineRoute('/portfolio/factor-risk', 'advanced_portfolio', 'FactorRiskRequest', 'FactorRiskResponse', 'factor_risk_optimize'),
    EngineRoute('/portfolio/tracking-error', 'advanced_portfolio', 'TrackingErrorRequest', 'TrackingErrorResponse', 'tracking_error_optimize'),
    EngineRoute('/portfolio/tax-aware-rebalance', 'advanced_portfolio', 'TaxAwareRequest', 'TaxAwareResponse', 'tax_aware_rebalance'),
    EngineRoute('/portfolio/stress-aware', 'advanced_portfolio', 'StressAwareRequest', 'StressAwareResponse', 'stress_aware_optimize'),
    EngineRoute('/portfolio/regime-blend', 'advanced_portfolio', 'RegimeBlendRequest', 'RegimeBlendResponse', 'regime_conditioned_blend'),
    EngineRoute('/portfolio/black-litterman', 'portfolio_bayesian', 'BlackLittermanRequest', 'BlackLittermanResponse', 'black_litterman'),
    EngineRoute('/portfolio/bayesian-mean-shrinkage', 'portfolio_bayesian', 'BayesianMeanShrinkageRequest', 'BayesianMeanShrinkageResponse', 'bayesian_mean_shrinkage'),
    EngineRoute('/portfolio/ledoit-wolf-covariance', 'portfolio_bayesian', 'RobustCovarianceRequest', 'RobustCovarianceResponse', 'ledoit_wolf_covariance'),
    EngineRoute('/valuation/probabilistic-dcf', 'advanced_valuation', 'ProbabilisticDcfRequest', 'ProbabilisticDcfResponse', 'probabilistic_dcf'),
    EngineRoute('/valuation/dcf-sensitivity', 'advanced_valuation', 'DcfSensitivityRequest', 'DcfSensitivityResponse', 'dcf_sensitivity'),
    EngineRoute('/valuation/reverse-dcf', 'advanced_valuation', 'ReverseDcfRequest', 'ReverseDcfResponse', 'reverse_dcf'),
    EngineRoute('/valuation/residual-income', 'advanced_valuation', 'ResidualIncomeRequest', 'ResidualIncomeResponse', 'residual_income_valuation'),
    EngineRoute('/valuation/eva', 'advanced_valuation', 'EvaRequest', 'EvaResponse', 'eva_valuation'),
    EngineRoute('/valuation/sotp', 'advanced_valuation', 'SotpRequest', 'SotpResponse', 'sum_of_parts'),
    EngineRoute('/valuation/merger-accretion', 'advanced_valuation', 'MergerRequest', 'MergerResponse', 'merger_accretion_dilution'),
    EngineRoute('/valuation/real-option', 'valuation_specialized', 'RealOptionRequest', 'RealOptionResponse', 'real_option_value'),
    EngineRoute('/valuation/expectation-surface', 'valuation_specialized', 'DcfExpectationSurfaceRequest', 'DcfExpectationSurfaceResponse', 'dcf_expectation_surface'),
    EngineRoute('/valuation/project-finance', 'valuation_specialized', 'ProjectFinanceRequest', 'ProjectFinanceResponse', 'project_finance'),
    EngineRoute('/valuation/saas-cohort', 'valuation_specialized', 'SaaSCohortRequest', 'SaaSCohortResponse', 'saas_cohort_value'),
    EngineRoute('/valuation/insurance-embedded-value', 'valuation_specialized', 'InsuranceEmbeddedValueRequest', 'InsuranceEmbeddedValueResponse', 'insurance_embedded_value'),
    EngineRoute('/credit/merton', 'advanced_credit', 'MertonRequest', 'MertonResponse', 'merton_structural'),
    EngineRoute('/credit/rating-migration', 'advanced_credit', 'MigrationMatrixRequest', 'MigrationMatrixResponse', 'rating_migration'),
    EngineRoute('/credit/creditmetrics', 'advanced_credit', 'CreditMetricsRequest', 'CreditMetricsResponse', 'creditmetrics_portfolio'),
    EngineRoute('/credit/stress-pd', 'advanced_credit', 'StressPdRequest', 'StressPdResponse', 'stress_pd'),
    EngineRoute('/credit/covenant-headroom', 'advanced_credit', 'CovenantRequest', 'CovenantResponse', 'covenant_headroom'),
    EngineRoute('/econometrics/weak-instruments', 'advanced_econometrics', 'WeakInstrumentRequest', 'WeakInstrumentResponse', 'weak_instrument_diagnostics'),
    EngineRoute('/econometrics/event-study', 'advanced_econometrics', 'EventStudyRequest', 'EventStudyResponse', 'event_study'),
    EngineRoute('/econometrics/synthetic-control', 'advanced_econometrics', 'SyntheticControlRequest', 'SyntheticControlResponse', 'synthetic_control'),
    EngineRoute('/econometrics/propensity-match', 'advanced_econometrics', 'PropensityMatchRequest', 'PropensityMatchResponse', 'propensity_score_match'),
    EngineRoute('/econometrics/local-projections', 'advanced_econometrics', 'LocalProjectionRequest', 'LocalProjectionResponse', 'local_projections'),
    EngineRoute('/econometrics/bayesian-var', 'advanced_econometrics', 'BayesianVarRequest', 'BayesianVarResponse', 'bayesian_var'),
    EngineRoute('/forecasting/model-tournament', 'advanced_forecasting', 'ForecastTournamentRequest', 'ForecastTournamentResponse', 'forecast_tournament'),
    EngineRoute('/forecasting/probabilistic-ar1', 'advanced_forecasting', 'ProbabilisticForecastRequest', 'ProbabilisticForecastResponse', 'probabilistic_ar1'),
    EngineRoute('/forecasting/reconcile-hierarchy', 'advanced_forecasting', 'HierarchicalForecastRequest', 'HierarchicalForecastResponse', 'reconcile_hierarchy'),
    EngineRoute('/forecasting/nowcast', 'advanced_forecasting', 'NowcastRequest', 'NowcastResponse', 'linear_nowcast'),
    EngineRoute('/forecasting/regime-conditioned', 'advanced_forecasting', 'RegimeForecastRequest', 'RegimeForecastResponse', 'regime_conditioned_forecast'),
    EngineRoute('/risk/tail-report', 'advanced_risk', 'TailRiskRequest', 'TailRiskResponse', 'tail_risk_report'),
    EngineRoute('/risk/liquidity-var', 'advanced_risk', 'LiquidityRiskRequest', 'LiquidityRiskResponse', 'liquidity_var'),
    EngineRoute('/risk/reverse-stress', 'advanced_risk', 'ReverseStressRequest', 'ReverseStressResponse', 'reverse_stress'),
    EngineRoute('/risk/correlation-breakdown', 'advanced_risk', 'CorrelationBreakdownRequest', 'CorrelationBreakdownResponse', 'correlation_breakdown'),
    EngineRoute('/supply-chain/facility-location', 'advanced_supply_chain', 'FacilityLocationRequest', 'FacilityLocationResponse', 'facility_location_milp'),
    EngineRoute('/supply-chain/stochastic-inventory', 'advanced_supply_chain', 'StochasticInventoryRequest', 'StochasticInventoryResponse', 'stochastic_inventory'),
    EngineRoute('/supply-chain/supplier-portfolio', 'advanced_supply_chain', 'SupplierPortfolioRequest', 'SupplierPortfolioResponse', 'supplier_portfolio'),
    EngineRoute('/supply-chain/disruption-simulation', 'advanced_supply_chain', 'DisruptionSimulationRequest', 'DisruptionSimulationResponse', 'disruption_simulation'),
    EngineRoute('/supply-chain/resilience-frontier', 'advanced_supply_chain', 'ResilienceFrontierRequest', 'ResilienceFrontierResponse', 'resilience_frontier'),
    EngineRoute('/climate/financed-emissions', 'advanced_climate', 'FinancedEmissionsRequest', 'FinancedEmissionsResponse', 'financed_emissions'),
    EngineRoute('/climate/climate-var', 'advanced_climate', 'ClimateVaRRequest', 'ClimateVaRResponse', 'climate_var'),
    EngineRoute('/climate/abatement-curve', 'advanced_climate', 'AbatementCurveRequest', 'AbatementCurveResponse', 'marginal_abatement_curve'),
    EngineRoute('/climate/transition-pathway', 'advanced_climate', 'TransitionPathwayRequest', 'TransitionPathwayResponse', 'transition_pathway'),
    EngineRoute('/macro/yield-curve-signals', 'advanced_macro', 'YieldCurveSignalRequest', 'YieldCurveSignalResponse', 'yield_curve_signals'),
    EngineRoute('/macro/financial-conditions-index', 'advanced_macro', 'FCIRequest', 'FCIResponse', 'financial_conditions_index'),
    EngineRoute('/macro/recession-probability', 'advanced_macro', 'RecessionModelRequest', 'RecessionModelResponse', 'recession_probability'),
    EngineRoute('/macro/inflation-decomposition', 'advanced_macro', 'InflationDecompositionRequest', 'InflationDecompositionResponse', 'inflation_decomposition'),
    EngineRoute('/macro/company-transmission', 'advanced_macro', 'MacroTransmissionRequest', 'MacroTransmissionResponse', 'macro_company_transmission'),
    EngineRoute('/macro/fiscal-multiplier', 'advanced_macro', 'FiscalMultiplierRequest', 'FiscalMultiplierResponse', 'fiscal_multiplier'),
    EngineRoute('/research/evidence-graph', 'advanced_research', 'EvidenceGraphRequest', 'EvidenceGraphResponse', 'assess_evidence_graph'),
    EngineRoute('/research/filing-diff', 'advanced_research', 'FilingDiffRequest', 'FilingDiffResponse', 'filing_diff'),
    EngineRoute('/research/consensus-divergence', 'advanced_research', 'ConsensusDivergenceRequest', 'ConsensusDivergenceResponse', 'consensus_divergence'),
    EngineRoute('/research/catalyst-monitor', 'advanced_research', 'CatalystMonitorRequest', 'CatalystMonitorResponse', 'catalyst_monitor'),
    EngineRoute('/financial-modeling/three-statement', 'advanced_financial_modeling', 'ThreeStatementRequest', 'ThreeStatementResponse', 'integrated_three_statement'),
    EngineRoute('/decision/model-tournament', 'decision_supercomputer', 'ModelTournamentRequest', 'ModelTournamentResponse', 'model_tournament'),
    EngineRoute('/decision/scenario-graph', 'decision_supercomputer', 'ScenarioGraphRequest', 'ScenarioGraphResponse', 'propagate_scenario'),
    EngineRoute('/decision/uncertainty', 'decision_supercomputer', 'LinearUncertaintyRequest', 'LinearUncertaintyResponse', 'linear_uncertainty'),
    EngineRoute('/decision/value-of-information', 'decision_supercomputer', 'ValueOfInformationRequest', 'ValueOfInformationResponse', 'value_of_information'),
    EngineRoute('/decision/mcda', 'decision_supercomputer', 'MCDARequest', 'MCDAResponse', 'topsis_mcda'),
)

ROUTES_BY_PATH = {
    **{route.path: route for route in BASE_ROUTES},
    **{f"/advanced{route.path}": route for route in ADVANCED_ROUTES},
}


class EngineInputError(ValueError):
    def __init__(self, message: str, *, validation_errors=None, worker_message=None):
        super().__init__(message)
        self.validation_errors = validation_errors
        self.worker_message = message if worker_message is None else worker_message


class EngineUnavailableError(RuntimeError):
    pass


# Inspect only already-loaded exception modules after a selected engine fails.
# Optional numerical packs must never be imported merely to build an except tuple.
_NUMERICAL_DOMAIN_EXCEPTIONS = {
    "statsmodels.tools.sm_exceptions": ("PerfectSeparationError", "MissingDataError"),
    "linearmodels.panel.utility": ("AbsorbingEffectError",),
    "linearmodels.panel.model": ("AmbiguityError",),
    "scipy.optimize._nonlin": ("NoConvergence",),
    "scipy.optimize._optimize": ("BracketError",),
    "ruptures.exceptions": ("NotEnoughPoints", "BadSegmentationParameters"),
    "networkx.exception": (
        "NetworkXPointlessConcept", "NetworkXUnfeasible", "NetworkXUnbounded",
        "NodeNotFound", "HasACycle", "AmbiguousSolution", "ExceededMaxIterations",
    ),
}


def _is_numerical_domain_error(error):
    for module_name, names in _NUMERICAL_DOMAIN_EXCEPTIONS.items():
        module = sys.modules.get(module_name)
        if module is None:
            continue
        for name in names:
            exception_type = getattr(module, name, None)
            if isinstance(exception_type, type) and isinstance(error, exception_type):
                return True
    return False


def runtime_inventory():
    """Passive runtime metadata only: no imports or execution of numerical packs."""
    import platform
    from importlib.metadata import PackageNotFoundError, version

    packages = {}
    for package in [
        "fastapi", "uvicorn", "numpy", "scipy", "pydantic", "statsmodels", "pandas",
        "linearmodels", "QuantLib", "arch", "ruptures", "scikit-learn",
        "networkx", "pymoo", "SALib", "asteval", "edgartools", "yfinance",
    ]:
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "unavailable"
    return {"ok": True, "python": platform.python_version(), "packages": packages}


def resolve_route(route: EngineRoute):
    """Load only the selected canonical engine, never a request-supplied module."""
    try:
        module = importlib.import_module(route.module)
        return (
            getattr(module, route.request_model),
            getattr(module, route.response_model),
            getattr(module, route.function),
        )
    except ImportError as exc:
        missing = exc.name or route.module
        raise EngineUnavailableError(
            f"Numerical engine {route.module} is unavailable: required pack {missing} is not installed or loadable."
        ) from exc


def input_contract(body):
    """Resolve only the canonical allowlisted request model; never execute it."""
    if not isinstance(body, dict) or set(body) != {"route"}:
        raise EngineInputError("Input contract requires exactly a canonical route.")
    route = ROUTES_BY_PATH.get(body["route"]) if isinstance(body["route"], str) else None
    if route is None:
        raise EngineInputError("Unknown numerical route.")
    request_model, _, _ = resolve_route(route)
    schema = request_model.model_json_schema()
    return {"route": body["route"], "fields": list(schema.get("properties", {})),
            "required": schema.get("required", [])}


def _require_finite(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise EngineInputError("Numerical request values must be finite.")
    if isinstance(value, dict):
        for item in value.values():
            _require_finite(item)
    elif isinstance(value, list):
        for item in value:
            _require_finite(item)


def dispatch(route_path: str, body):
    """Validate and execute the same request/response contracts for both transports."""
    route = ROUTES_BY_PATH.get(route_path)
    if route is None:
        raise EngineInputError("Unknown numerical route.")
    _require_finite(body)
    request_model, response_model, fn = resolve_route(route)
    try:
        request = request_model.model_validate(body)
    except ValidationError as exc:
        errors = exc.errors(include_url=False)
        # Validation locations may include customer-supplied dictionary keys.
        # The HTTP contract retains its existing detailed 422 error separately.
        summary = "; ".join(dict.fromkeys(error["type"] for error in errors[:20]))
        raise EngineInputError(
            f"Invalid numerical request: {summary}", validation_errors=errors
        ) from exc
    _require_finite(request.model_dump(mode="python"))
    try:
        result = fn(request)
    except ImportError as exc:
        missing = exc.name or route.module
        raise EngineUnavailableError(
            f"Numerical engine {route.module} is unavailable: required pack {missing} is not installed or loadable."
        ) from exc
    except (ValueError, ArithmeticError) as exc:
        raise EngineInputError(
            str(exc),
            worker_message="Numerical request violates the selected engine's input constraints.",
        ) from exc
    except Exception as exc:
        # Preserve known library data/convergence failures as input errors,
        # while programming and unexpected engine failures still fail execution.
        if not _is_numerical_domain_error(exc):
            raise
        raise EngineInputError(
            str(exc),
            worker_message="Numerical request violates the selected engine's input constraints.",
        ) from exc
    # Invalid engine output is a broken execution, not a user-input error.
    return response_model.model_validate(result)
