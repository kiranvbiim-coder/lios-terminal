"""
Limuria Python sidecar.

Node (server/pythonService.ts) spawns this as a subprocess on server boot and
talks to it over loopback HTTP -- same "AI validates, never calculates"
doctrine as the rest of the Terminal: every route here is deterministic
compute, no LLM calls, no client-facing exposure of its own. Node owns auth,
routing, and metering; this process only ever does the math a real Python
library does better than a hand-rolled TS reimplementation.
"""

import platform
from importlib.metadata import PackageNotFoundError, version

from fastapi import FastAPI, HTTPException

from fixed_income import BondPriceRequest, BondPriceResponse, price_bond
import portfolio_optimization as popt
import credit_operational_risk as cor
import statistics_econometrics as stats_econ
import professional_statistics as pro_stats
import econometrics as econ
import options_volatility as optvol
import forecasting as fcst
import economics_policy as econpol
import ml_cluster as mlc
import supply_chain as sc
import environment as env
import optimization_engine as optim
import sec_search
from advanced_routes import router as advanced_router
from sidecar_auth import SidecarTokenMiddleware, load_token
from parent_watchdog import start_from_environment as start_parent_watchdog

# Fail closed: load_token() raises when LIOS_SIDECAR_TOKEN is unset (see sidecar_auth.py).
_SIDECAR_TOKEN = load_token()
# Exit if the Node launcher disappears without stopping us (crash, force-quit): no orphaned sidecars.
start_parent_watchdog()

app = FastAPI(title="Limuria Python Sidecar")
app.include_router(advanced_router)
# Pure-ASGI middleware: covers every route including /docs and /openapi.json.
# GET /health is the only unauthenticated route.
app.add_middleware(SidecarTokenMiddleware, token=_SIDECAR_TOKEN)


def _run(fn, req):
    try:
        return fn(req)
    except Exception as exc:  # noqa: BLE001 -- surfaced to the caller, not swallowed
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/health")
def health():
    # Unauthenticated liveness probe: deliberately no versions, packages or paths.
    return {"ok": True}


@app.get("/runtime-info")
def runtime_info():
    packages = {}
    for package in ["fastapi", "uvicorn", "numpy", "scipy", "statsmodels", "pandas", "linearmodels", "QuantLib", "arch", "ruptures", "scikit-learn", "networkx", "pymoo", "SALib", "asteval", "edgartools", "yfinance"]:
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "unavailable"
    return {"ok": True, "python": platform.python_version(), "packages": packages}


@app.post("/fixed-income/bond-price", response_model=BondPriceResponse)
def fixed_income_bond_price(req: BondPriceRequest):
    return _run(price_bond, req)


@app.post("/portfolio/min-variance", response_model=popt.WeightsResponse)
def portfolio_min_variance(req: popt.MeanVarianceRequest):
    return _run(popt.min_variance, req)


@app.post("/portfolio/max-sharpe", response_model=popt.WeightsResponse)
def portfolio_max_sharpe(req: popt.MaxSharpeRequest):
    return _run(popt.max_sharpe, req)


@app.post("/portfolio/efficient-frontier", response_model=popt.EfficientFrontierResponse)
def portfolio_efficient_frontier(req: popt.EfficientFrontierRequest):
    return _run(popt.efficient_frontier, req)


@app.post("/portfolio/risk-parity", response_model=popt.WeightsResponse)
def portfolio_risk_parity(req: popt.CovOnlyRequest):
    return _run(popt.risk_parity, req)


@app.post("/portfolio/max-diversification", response_model=popt.WeightsResponse)
def portfolio_max_diversification(req: popt.MaxDiversificationRequest):
    return _run(popt.max_diversification, req)


@app.post("/portfolio/mean-cvar", response_model=popt.MeanCVaRResponse)
def portfolio_mean_cvar(req: popt.MeanCVaRRequest):
    return _run(popt.mean_cvar_optimization, req)


@app.post("/credit/credit-var", response_model=cor.CreditVarResponse)
def credit_credit_var(req: cor.CreditVarRequest):
    return _run(cor.credit_var, req)


@app.post("/credit/operational-risk-lda", response_model=cor.OperationalRiskResponse)
def credit_operational_risk_lda(req: cor.OperationalRiskRequest):
    return _run(cor.operational_risk_lda, req)


@app.post("/stats/normality", response_model=stats_econ.NormalityResponse)
def stats_normality(req: stats_econ.NormalityRequest):
    return _run(stats_econ.normality_tests, req)


@app.post("/stats/hypothesis-tests", response_model=stats_econ.HypothesisTestResponse)
def stats_hypothesis_tests(req: stats_econ.HypothesisTestRequest):
    return _run(stats_econ.hypothesis_tests, req)


@app.post("/stats/correlation", response_model=stats_econ.CorrelationResponse)
def stats_correlation(req: stats_econ.CorrelationRequest):
    return _run(stats_econ.correlation_analysis, req)


@app.post("/stats/partial-correlation", response_model=stats_econ.PartialCorrelationResponse)
def stats_partial_correlation(req: stats_econ.PartialCorrelationRequest):
    return _run(stats_econ.partial_correlation, req)


@app.post("/stats/ols-diagnostics", response_model=stats_econ.RegressionResponse)
def stats_ols_diagnostics(req: stats_econ.RegressionRequest):
    return _run(stats_econ.ols_diagnostics, req)


@app.post("/stats/gls", response_model=stats_econ.RegressionResponse)
def stats_gls(req: stats_econ.WeightedRegressionRequest):
    return _run(stats_econ.gls_regression, req)


@app.post("/stats/logistic", response_model=stats_econ.BinaryRegressionResponse)
def stats_logistic(req: stats_econ.RegressionRequest):
    return _run(stats_econ.logistic_regression, req)


@app.post("/stats/probit", response_model=stats_econ.BinaryRegressionResponse)
def stats_probit(req: stats_econ.RegressionRequest):
    return _run(stats_econ.probit_regression, req)


@app.post("/stats/robust-regression", response_model=stats_econ.RobustRegressionResponse)
def stats_robust_regression(req: stats_econ.RobustRegressionRequest):
    return _run(stats_econ.robust_regression, req)


@app.post("/stats/influence-diagnostics", response_model=stats_econ.InfluenceDiagnosticsResponse)
def stats_influence_diagnostics(req: stats_econ.RegressionRequest):
    return _run(stats_econ.influence_diagnostics, req)


@app.post("/stats/vif", response_model=stats_econ.VifResponse)
def stats_vif(req: stats_econ.VifRequest):
    return _run(stats_econ.variance_inflation_factors, req)


@app.post("/stats/reset-test", response_model=stats_econ.ResetTestResponse)
def stats_reset_test(req: stats_econ.RegressionRequest):
    return _run(stats_econ.reset_test, req)


@app.post("/stats/autocorrelation-tests", response_model=stats_econ.AutocorrelationTestResponse)
def stats_autocorrelation_tests(req: stats_econ.AutocorrelationTestRequest):
    return _run(stats_econ.autocorrelation_tests, req)


@app.post("/stats/descriptive-diagnostics", response_model=pro_stats.StatisticsResponse)
def stats_descriptive_diagnostics(req: pro_stats.DescriptiveRequest):
    return _run(pro_stats.descriptive_diagnostics, req)


@app.post("/stats/distribution-fit", response_model=pro_stats.StatisticsResponse)
def stats_distribution_fit(req: pro_stats.DistributionFitRequest):
    return _run(pro_stats.distribution_fit, req)


@app.post("/stats/professional-inference", response_model=pro_stats.StatisticsResponse)
def stats_professional_inference(req: pro_stats.InferenceRequest):
    return _run(pro_stats.professional_inference, req)


@app.post("/stats/seeded-resampling", response_model=pro_stats.StatisticsResponse)
def stats_seeded_resampling(req: pro_stats.ResamplingRequest):
    return _run(pro_stats.seeded_resampling, req)


@app.post("/stats/multiple-testing", response_model=pro_stats.StatisticsResponse)
def stats_multiple_testing(req: pro_stats.MultipleTestingRequest):
    return _run(pro_stats.multiple_testing, req)


@app.post("/stats/multivariate-structure", response_model=pro_stats.StatisticsResponse)
def stats_multivariate_structure(req: pro_stats.MultivariateRequest):
    return _run(pro_stats.multivariate_structure, req)


@app.post("/stats/bayesian-normal", response_model=pro_stats.StatisticsResponse)
def stats_bayesian_normal(req: pro_stats.BayesianNormalRequest):
    return _run(pro_stats.bayesian_normal, req)


@app.post("/econometrics/panel-ols", response_model=econ.PanelOlsResponse)
def econometrics_panel_ols(req: econ.PanelOlsRequest):
    return _run(econ.panel_ols, req)


@app.post("/econometrics/iv-2sls", response_model=econ.Iv2SlsResponse)
def econometrics_iv_2sls(req: econ.Iv2SlsRequest):
    return _run(econ.iv_2sls, req)


@app.post("/econometrics/did", response_model=econ.DidResponse)
def econometrics_did(req: econ.DidRequest):
    return _run(econ.difference_in_differences, req)


@app.post("/econometrics/rd", response_model=econ.RdResponse)
def econometrics_rd(req: econ.RdRequest):
    return _run(econ.regression_discontinuity, req)


@app.post("/econometrics/var", response_model=econ.VarResponse)
def econometrics_var(req: econ.VarRequest):
    return _run(econ.var_model, req)


@app.post("/econometrics/vecm", response_model=econ.VecmResponse)
def econometrics_vecm(req: econ.VecmRequest):
    return _run(econ.vecm_model, req)


@app.post("/econometrics/granger", response_model=econ.GrangerResponse)
def econometrics_granger(req: econ.GrangerRequest):
    return _run(econ.granger_causality, req)


@app.post("/econometrics/johansen", response_model=econ.JohansenResponse)
def econometrics_johansen(req: econ.JohansenRequest):
    return _run(econ.johansen_cointegration, req)


@app.post("/econometrics/unit-root", response_model=econ.UnitRootResponse)
def econometrics_unit_root(req: econ.UnitRootRequest):
    return _run(econ.unit_root_tests, req)


@app.post("/econometrics/heteroskedasticity", response_model=econ.HeteroskedasticityResponse)
def econometrics_heteroskedasticity(req: econ.HeteroskedasticityRequest):
    return _run(econ.heteroskedasticity_tests, req)


@app.post("/econometrics/quantile-regression", response_model=econ.QuantileRegressionResponse)
def econometrics_quantile_regression(req: econ.QuantileRegressionRequest):
    return _run(econ.quantile_regression, req)


@app.post("/econometrics/sur", response_model=econ.SurResponse)
def econometrics_sur(req: econ.SurRequest):
    return _run(econ.seemingly_unrelated_regression, req)


@app.post("/econometrics/mixed-effects-panel", response_model=econ.MixedEffectsResponse)
def econometrics_mixed_effects_panel(req: econ.MixedEffectsRequest):
    return _run(econ.mixed_effects_panel, req)


@app.post("/options/sabr-calibrate", response_model=optvol.SabrCalibrateResponse)
def options_sabr_calibrate(req: optvol.SabrCalibrateRequest):
    return _run(optvol.sabr_calibrate, req)


@app.post("/options/sabr-smile", response_model=optvol.SabrSmileResponse)
def options_sabr_smile(req: optvol.SabrSmileRequest):
    return _run(optvol.sabr_smile, req)


@app.post("/options/heston-calibrate", response_model=optvol.HestonCalibrateResponse)
def options_heston_calibrate(req: optvol.HestonCalibrateRequest):
    return _run(optvol.heston_calibrate, req)


@app.post("/options/heston-price", response_model=optvol.HestonPriceResponse)
def options_heston_price(req: optvol.HestonPriceRequest):
    return _run(optvol.heston_price, req)


@app.post("/forecasting/sarimax", response_model=fcst.SarimaxResponse)
def forecasting_sarimax(req: fcst.SarimaxRequest):
    return _run(fcst.sarimax_forecast, req)


@app.post("/forecasting/stl", response_model=fcst.StlResponse)
def forecasting_stl(req: fcst.StlRequest):
    return _run(fcst.stl_decompose, req)


@app.post("/forecasting/changepoint", response_model=fcst.ChangepointResponse)
def forecasting_changepoint(req: fcst.ChangepointRequest):
    return _run(fcst.changepoint_detect, req)


@app.post("/forecasting/garch", response_model=fcst.GarchResponse)
def forecasting_garch(req: fcst.GarchRequest):
    return _run(fcst.garch_fit, req)


@app.post("/economics/leontief-io", response_model=econpol.LeontiefResponse)
def economics_leontief_io(req: econpol.LeontiefRequest):
    return _run(econpol.leontief_io, req)


@app.post("/economics/taylor-rule", response_model=econpol.TaylorRuleResponse)
def economics_taylor_rule(req: econpol.TaylorRuleRequest):
    return _run(econpol.taylor_rule, req)


@app.post("/economics/phillips-curve", response_model=econpol.PhillipsCurveResponse)
def economics_phillips_curve(req: econpol.PhillipsCurveRequest):
    return _run(econpol.phillips_curve, req)


@app.post("/economics/gini", response_model=econpol.GiniResponse)
def economics_gini(req: econpol.GiniRequest):
    return _run(econpol.gini_coefficient, req)


@app.post("/economics/income-tax-microsim", response_model=econpol.IncomeTaxMicrosimResponse)
def economics_income_tax_microsim(req: econpol.IncomeTaxMicrosimRequest):
    return _run(econpol.income_tax_microsim, req)


@app.post("/economics/carbon-tax-dividend", response_model=econpol.CarbonTaxDividendResponse)
def economics_carbon_tax_dividend(req: econpol.CarbonTaxDividendRequest):
    return _run(econpol.carbon_tax_dividend, req)


@app.post("/ml/classification", response_model=mlc.ClassificationResponse)
def ml_classification(req: mlc.ClassificationRequest):
    return _run(mlc.classification_pipeline, req)


@app.post("/ml/regression", response_model=mlc.MLRegressionResponse)
def ml_regression(req: mlc.RegressionRequest):
    return _run(mlc.regression_pipeline, req)


@app.post("/ml/clustering", response_model=mlc.ClusteringResponse)
def ml_clustering(req: mlc.ClusteringRequest):
    return _run(mlc.clustering_pipeline, req)


@app.post("/ml/anomaly-detection", response_model=mlc.AnomalyDetectionResponse)
def ml_anomaly_detection(req: mlc.AnomalyDetectionRequest):
    return _run(mlc.anomaly_detection, req)


@app.post("/supplychain/route-optimization", response_model=sc.TspResponse)
def supplychain_route_optimization(req: sc.TspRequest):
    return _run(sc.solve_tsp_2opt, req)


@app.post("/supplychain/safety-stock", response_model=sc.SafetyStockResponse)
def supplychain_safety_stock(req: sc.SafetyStockRequest):
    return _run(sc.multi_echelon_safety_stock, req)


@app.post("/supplychain/bullwhip", response_model=sc.BullwhipResponse)
def supplychain_bullwhip(req: sc.BullwhipRequest):
    return _run(sc.compute_bullwhip_effect, req)


@app.post("/supplychain/network-analysis", response_model=sc.NetworkAnalysisResponse)
def supplychain_network_analysis(req: sc.NetworkAnalysisRequest):
    return _run(sc.network_analysis, req)


@app.post("/supplychain/resilience", response_model=sc.ResilienceResponse)
def supplychain_resilience(req: sc.ResilienceRequest):
    return _run(sc.supply_chain_resilience_index, req)


@app.post("/environment/climate-transition-risk", response_model=env.ClimateTransitionRiskResponse)
def environment_climate_transition_risk(req: env.ClimateTransitionRiskRequest):
    return _run(env.climate_transition_risk, req)


@app.post("/environment/carbon-credit-mrv", response_model=env.CarbonCreditMrvResponse)
def environment_carbon_credit_mrv(req: env.CarbonCreditMrvRequest):
    return _run(env.carbon_credit_mrv_valuation, req)


@app.post("/optimization/genetic-algorithm", response_model=optim.GeneticAlgorithmResponse)
def optimization_genetic_algorithm(req: optim.GeneticAlgorithmRequest):
    return _run(optim.genetic_algorithm, req)


@app.post("/optimization/stochastic", response_model=optim.StochasticOptimizationResponse)
def optimization_stochastic(req: optim.StochasticOptimizationRequest):
    return _run(optim.stochastic_optimization, req)


@app.post("/optimization/multi-objective", response_model=optim.MultiObjectiveResponse)
def optimization_multi_objective(req: optim.MultiObjectiveRequest):
    return _run(optim.multi_objective_optimization, req)


@app.post("/optimization/sensitivity-analysis", response_model=optim.SensitivityAnalysisResponse)
def optimization_sensitivity_analysis(req: optim.SensitivityAnalysisRequest):
    return _run(optim.sensitivity_analysis, req)


@app.post("/sec/filing-search", response_model=sec_search.FilingSearchResponse)
def sec_filing_search(req: sec_search.FilingSearchRequest):
    return _run(sec_search.search_filings, req)
