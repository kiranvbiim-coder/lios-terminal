"""Typed FastAPI router for the LiOS institutional capability suite.

The manifest is intentionally centralized: every advanced engine has one stable path,
Pydantic request/response contract, and deterministic exception boundary.
"""
from __future__ import annotations

import inspect
from typing import Callable, Type

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import advanced_fixed_income as afi
import advanced_derivatives as ader
import advanced_portfolio as aport
import advanced_valuation as aval
import advanced_credit as acr
import advanced_econometrics as aecon
import advanced_forecasting as afc
import advanced_risk as arisk
import advanced_supply_chain as asc
import advanced_climate as aclim
import advanced_macro as amacro
import advanced_research as ares
import advanced_financial_modeling as afm
import decision_supercomputer as dsc
import fixed_income_structured as fis
import derivatives_surface as dsurf
import portfolio_bayesian as pbay
import valuation_specialized as vspec

router = APIRouter(prefix="/advanced", tags=["institutional-quant"])


def _endpoint(request_model: Type[BaseModel], response_model: Type[BaseModel], fn: Callable):
    async def handler(payload):
        try:
            return fn(payload)
        except Exception as exc:  # noqa: BLE001 -- convert deterministic model errors to data errors
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    handler.__name__ = f"advanced_{fn.__name__}"
    handler.__signature__ = inspect.Signature(
        parameters=[inspect.Parameter("payload", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=request_model)],
        return_annotation=response_model,
    )
    return handler


ROUTES = [
    # Fixed income
    ("/fixed-income/bootstrap-par-curve", afi.BootstrapCurveRequest, afi.BootstrapCurveResponse, afi.bootstrap_par_curve),
    ("/fixed-income/spread-analytics", afi.SpreadAnalyticsRequest, afi.SpreadAnalyticsResponse, afi.spread_analytics),
    ("/fixed-income/key-rate-risk", afi.KeyRateRiskRequest, afi.KeyRateRiskResponse, afi.key_rate_risk),
    ("/fixed-income/immunize-duration", afi.ImmunizationRequest, afi.ImmunizationResponse, afi.immunize_duration),
    ("/fixed-income/callable-oas", fis.CallableBondOasRequest, fis.CallableBondOasResponse, fis.callable_bond_oas),
    ("/fixed-income/floating-rate-note", fis.FloatingRateNoteRequest, fis.FloatingRateNoteResponse, fis.floating_rate_note),
    ("/fixed-income/inflation-linked-bond", fis.InflationLinkedBondRequest, fis.InflationLinkedBondResponse, fis.inflation_linked_bond),
    ("/fixed-income/credit-spread-curve", fis.CreditSpreadCurveRequest, fis.CreditSpreadCurveResponse, fis.credit_spread_curve),
    # Derivatives
    ("/derivatives/black-scholes-greeks", ader.BlackScholesRequest, ader.GreeksResponse, ader.black_scholes_greeks),
    ("/derivatives/implied-volatility", ader.ImpliedVolRequest, ader.ImpliedVolResponse, ader.implied_volatility),
    ("/derivatives/surface-arbitrage", ader.VolSurfaceCheckRequest, ader.VolSurfaceCheckResponse, ader.check_vol_surface_arbitrage),
    ("/derivatives/exotic-monte-carlo", ader.ExoticMonteCarloRequest, ader.ExoticMonteCarloResponse, ader.exotic_monte_carlo),
    ("/derivatives/interest-rate-swap", ader.SwapRequest, ader.SwapResponse, ader.interest_rate_swap),
    ("/derivatives/black-swaption", ader.SwaptionRequest, ader.SwaptionResponse, ader.black_swaption),
    ("/derivatives/local-volatility", dsurf.LocalVolRequest, dsurf.LocalVolResponse, dsurf.dupire_local_vol),
    ("/derivatives/portfolio-greeks", dsurf.PortfolioGreeksRequest, dsurf.PortfolioGreeksResponse, dsurf.portfolio_greeks),
    ("/derivatives/futures-basis", dsurf.FuturesBasisRequest, dsurf.FuturesBasisResponse, dsurf.futures_basis),
    ("/derivatives/strategy-payoff", dsurf.OptionStrategyRequest, dsurf.OptionStrategyResponse, dsurf.option_strategy_payoff),
    # Portfolio
    ("/portfolio/hrp", aport.HrpRequest, aport.WeightsResponse, aport.hierarchical_risk_parity),
    ("/portfolio/risk-budget", aport.RiskBudgetRequest, aport.RiskBudgetResponse, aport.risk_budget_optimization),
    ("/portfolio/factor-risk", aport.FactorRiskRequest, aport.FactorRiskResponse, aport.factor_risk_optimize),
    ("/portfolio/tracking-error", aport.TrackingErrorRequest, aport.TrackingErrorResponse, aport.tracking_error_optimize),
    ("/portfolio/tax-aware-rebalance", aport.TaxAwareRequest, aport.TaxAwareResponse, aport.tax_aware_rebalance),
    ("/portfolio/stress-aware", aport.StressAwareRequest, aport.StressAwareResponse, aport.stress_aware_optimize),
    ("/portfolio/regime-blend", aport.RegimeBlendRequest, aport.RegimeBlendResponse, aport.regime_conditioned_blend),
    ("/portfolio/black-litterman", pbay.BlackLittermanRequest, pbay.BlackLittermanResponse, pbay.black_litterman),
    ("/portfolio/bayesian-mean-shrinkage", pbay.BayesianMeanShrinkageRequest, pbay.BayesianMeanShrinkageResponse, pbay.bayesian_mean_shrinkage),
    ("/portfolio/ledoit-wolf-covariance", pbay.RobustCovarianceRequest, pbay.RobustCovarianceResponse, pbay.ledoit_wolf_covariance),
    # Valuation
    ("/valuation/probabilistic-dcf", aval.ProbabilisticDcfRequest, aval.ProbabilisticDcfResponse, aval.probabilistic_dcf),
    ("/valuation/dcf-sensitivity", aval.DcfSensitivityRequest, aval.DcfSensitivityResponse, aval.dcf_sensitivity),
    ("/valuation/reverse-dcf", aval.ReverseDcfRequest, aval.ReverseDcfResponse, aval.reverse_dcf),
    ("/valuation/residual-income", aval.ResidualIncomeRequest, aval.ResidualIncomeResponse, aval.residual_income_valuation),
    ("/valuation/eva", aval.EvaRequest, aval.EvaResponse, aval.eva_valuation),
    ("/valuation/sotp", aval.SotpRequest, aval.SotpResponse, aval.sum_of_parts),
    ("/valuation/merger-accretion", aval.MergerRequest, aval.MergerResponse, aval.merger_accretion_dilution),
    ("/valuation/real-option", vspec.RealOptionRequest, vspec.RealOptionResponse, vspec.real_option_value),
    ("/valuation/expectation-surface", vspec.DcfExpectationSurfaceRequest, vspec.DcfExpectationSurfaceResponse, vspec.dcf_expectation_surface),
    ("/valuation/project-finance", vspec.ProjectFinanceRequest, vspec.ProjectFinanceResponse, vspec.project_finance),
    ("/valuation/saas-cohort", vspec.SaaSCohortRequest, vspec.SaaSCohortResponse, vspec.saas_cohort_value),
    ("/valuation/insurance-embedded-value", vspec.InsuranceEmbeddedValueRequest, vspec.InsuranceEmbeddedValueResponse, vspec.insurance_embedded_value),
    # Credit
    ("/credit/merton", acr.MertonRequest, acr.MertonResponse, acr.merton_structural),
    ("/credit/rating-migration", acr.MigrationMatrixRequest, acr.MigrationMatrixResponse, acr.rating_migration),
    ("/credit/creditmetrics", acr.CreditMetricsRequest, acr.CreditMetricsResponse, acr.creditmetrics_portfolio),
    ("/credit/stress-pd", acr.StressPdRequest, acr.StressPdResponse, acr.stress_pd),
    ("/credit/covenant-headroom", acr.CovenantRequest, acr.CovenantResponse, acr.covenant_headroom),
    # Econometrics
    ("/econometrics/weak-instruments", aecon.WeakInstrumentRequest, aecon.WeakInstrumentResponse, aecon.weak_instrument_diagnostics),
    ("/econometrics/event-study", aecon.EventStudyRequest, aecon.EventStudyResponse, aecon.event_study),
    ("/econometrics/synthetic-control", aecon.SyntheticControlRequest, aecon.SyntheticControlResponse, aecon.synthetic_control),
    ("/econometrics/propensity-match", aecon.PropensityMatchRequest, aecon.PropensityMatchResponse, aecon.propensity_score_match),
    ("/econometrics/local-projections", aecon.LocalProjectionRequest, aecon.LocalProjectionResponse, aecon.local_projections),
    ("/econometrics/bayesian-var", aecon.BayesianVarRequest, aecon.BayesianVarResponse, aecon.bayesian_var),
    # Forecasting
    ("/forecasting/model-tournament", afc.ForecastTournamentRequest, afc.ForecastTournamentResponse, afc.forecast_tournament),
    ("/forecasting/probabilistic-ar1", afc.ProbabilisticForecastRequest, afc.ProbabilisticForecastResponse, afc.probabilistic_ar1),
    ("/forecasting/reconcile-hierarchy", afc.HierarchicalForecastRequest, afc.HierarchicalForecastResponse, afc.reconcile_hierarchy),
    ("/forecasting/nowcast", afc.NowcastRequest, afc.NowcastResponse, afc.linear_nowcast),
    ("/forecasting/regime-conditioned", afc.RegimeForecastRequest, afc.RegimeForecastResponse, afc.regime_conditioned_forecast),
    # Tail / liquidity / reverse stress
    ("/risk/tail-report", arisk.TailRiskRequest, arisk.TailRiskResponse, arisk.tail_risk_report),
    ("/risk/liquidity-var", arisk.LiquidityRiskRequest, arisk.LiquidityRiskResponse, arisk.liquidity_var),
    ("/risk/reverse-stress", arisk.ReverseStressRequest, arisk.ReverseStressResponse, arisk.reverse_stress),
    ("/risk/correlation-breakdown", arisk.CorrelationBreakdownRequest, arisk.CorrelationBreakdownResponse, arisk.correlation_breakdown),
    # Supply chain
    ("/supply-chain/facility-location", asc.FacilityLocationRequest, asc.FacilityLocationResponse, asc.facility_location_milp),
    ("/supply-chain/stochastic-inventory", asc.StochasticInventoryRequest, asc.StochasticInventoryResponse, asc.stochastic_inventory),
    ("/supply-chain/supplier-portfolio", asc.SupplierPortfolioRequest, asc.SupplierPortfolioResponse, asc.supplier_portfolio),
    ("/supply-chain/disruption-simulation", asc.DisruptionSimulationRequest, asc.DisruptionSimulationResponse, asc.disruption_simulation),
    ("/supply-chain/resilience-frontier", asc.ResilienceFrontierRequest, asc.ResilienceFrontierResponse, asc.resilience_frontier),
    # Climate
    ("/climate/financed-emissions", aclim.FinancedEmissionsRequest, aclim.FinancedEmissionsResponse, aclim.financed_emissions),
    ("/climate/climate-var", aclim.ClimateVaRRequest, aclim.ClimateVaRResponse, aclim.climate_var),
    ("/climate/abatement-curve", aclim.AbatementCurveRequest, aclim.AbatementCurveResponse, aclim.marginal_abatement_curve),
    ("/climate/transition-pathway", aclim.TransitionPathwayRequest, aclim.TransitionPathwayResponse, aclim.transition_pathway),
    # Macro
    ("/macro/yield-curve-signals", amacro.YieldCurveSignalRequest, amacro.YieldCurveSignalResponse, amacro.yield_curve_signals),
    ("/macro/financial-conditions-index", amacro.FCIRequest, amacro.FCIResponse, amacro.financial_conditions_index),
    ("/macro/recession-probability", amacro.RecessionModelRequest, amacro.RecessionModelResponse, amacro.recession_probability),
    ("/macro/inflation-decomposition", amacro.InflationDecompositionRequest, amacro.InflationDecompositionResponse, amacro.inflation_decomposition),
    ("/macro/company-transmission", amacro.MacroTransmissionRequest, amacro.MacroTransmissionResponse, amacro.macro_company_transmission),
    ("/macro/fiscal-multiplier", amacro.FiscalMultiplierRequest, amacro.FiscalMultiplierResponse, amacro.fiscal_multiplier),
    # Research intelligence
    ("/research/evidence-graph", ares.EvidenceGraphRequest, ares.EvidenceGraphResponse, ares.assess_evidence_graph),
    ("/research/filing-diff", ares.FilingDiffRequest, ares.FilingDiffResponse, ares.filing_diff),
    ("/research/consensus-divergence", ares.ConsensusDivergenceRequest, ares.ConsensusDivergenceResponse, ares.consensus_divergence),
    ("/research/catalyst-monitor", ares.CatalystMonitorRequest, ares.CatalystMonitorResponse, ares.catalyst_monitor),
    # Financial modelling
    ("/financial-modeling/three-statement", afm.ThreeStatementRequest, afm.ThreeStatementResponse, afm.integrated_three_statement),
    # Decision supercomputer
    ("/decision/model-tournament", dsc.ModelTournamentRequest, dsc.ModelTournamentResponse, dsc.model_tournament),
    ("/decision/scenario-graph", dsc.ScenarioGraphRequest, dsc.ScenarioGraphResponse, dsc.propagate_scenario),
    ("/decision/uncertainty", dsc.LinearUncertaintyRequest, dsc.LinearUncertaintyResponse, dsc.linear_uncertainty),
    ("/decision/value-of-information", dsc.ValueOfInformationRequest, dsc.ValueOfInformationResponse, dsc.value_of_information),
    ("/decision/mcda", dsc.MCDARequest, dsc.MCDAResponse, dsc.topsis_mcda),
]

for path, request_model, response_model, fn in ROUTES:
    router.add_api_route(path, _endpoint(request_model, response_model, fn), methods=["POST"], response_model=response_model)
