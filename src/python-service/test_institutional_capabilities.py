import math
import unittest

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
import advanced_routes
import decision_supercomputer as dsc


class InstitutionalCapabilityTests(unittest.TestCase):
    def test_advanced_route_manifest_is_broad_and_unique(self):
        paths = [row[0] for row in advanced_routes.ROUTES]
        self.assertGreaterEqual(len(paths), 65)
        self.assertEqual(len(paths), len(set(paths)))
        self.assertIn("/decision/scenario-graph", paths)
        self.assertIn("/valuation/probabilistic-dcf", paths)
        self.assertIn("/supply-chain/facility-location", paths)

    def test_flat_par_curve_bootstraps_expected_discount_factors(self):
        out = afi.bootstrap_par_curve(afi.BootstrapCurveRequest(
            maturitiesYears=[0.5, 1.0, 1.5], parYieldsPct=[5.0, 5.0, 5.0], frequency=2,
        ))
        self.assertAlmostEqual(out.discountFactors[0], 1 / 1.025, places=10)
        self.assertAlmostEqual(out.discountFactors[1], 1 / (1.025 ** 2), places=10)
        self.assertAlmostEqual(out.discountFactors[2], 1 / (1.025 ** 3), places=10)

    def test_zero_zspread_reprices_curve_price(self):
        curve = [afi.CurveNode(maturityYears=1, zeroRatePct=4), afi.CurveNode(maturityYears=2, zeroRatePct=4)]
        cash = [afi.CashFlow(timeYears=1, amount=5), afi.CashFlow(timeYears=2, amount=105)]
        price = 5 * math.exp(-0.04) + 105 * math.exp(-0.08)
        out = afi.spread_analytics(afi.SpreadAnalyticsRequest(cashFlows=cash, curve=curve, marketPrice=price))
        self.assertAlmostEqual(out.zSpreadBps, 0.0, places=7)
        self.assertGreater(out.spreadDurationYears, 0)

    def test_duration_immunisation_hits_target(self):
        out = afi.immunize_duration(afi.ImmunizationRequest(
            assets=[afi.ImmunizationAsset(name="short", price=100, durationYears=2), afi.ImmunizationAsset(name="long", price=100, durationYears=6)],
            targetDurationYears=4,
        ))
        self.assertAlmostEqual(out.weights["short"], 0.5, places=7)
        self.assertAlmostEqual(out.weights["long"], 0.5, places=7)
        self.assertAlmostEqual(out.achievedDurationYears, 4.0, places=7)

    def test_implied_volatility_roundtrip(self):
        base = ader.BlackScholesRequest(spot=100, strike=100, maturityYears=1, ratePct=5, dividendYieldPct=0, volatilityPct=20, optionType="call")
        price = ader.black_scholes_greeks(base).price
        out = ader.implied_volatility(ader.ImpliedVolRequest(spot=100, strike=100, maturityYears=1, ratePct=5, dividendYieldPct=0, optionType="call", marketPrice=price))
        self.assertAlmostEqual(out.impliedVolatilityPct, 20.0, places=7)
        self.assertLess(out.absolutePricingError, 1e-8)

    def test_surface_arbitrage_detects_increasing_call_price_with_strike(self):
        out = ader.check_vol_surface_arbitrage(ader.VolSurfaceCheckRequest(
            spot=100, quotes=[
                ader.SurfaceQuote(maturityYears=1, strike=90, callPrice=12),
                ader.SurfaceQuote(maturityYears=1, strike=100, callPrice=13),
                ader.SurfaceQuote(maturityYears=1, strike=110, callPrice=4),
            ],
        ))
        self.assertFalse(out.arbitrageFree)
        self.assertTrue(any("call_monotonicity" in x for x in out.violations))

    def test_exotic_monte_carlo_is_seed_reproducible(self):
        req = ader.ExoticMonteCarloRequest(spot=100, strike=100, maturityYears=1, ratePct=2, volatilityPct=20, payoffType="digital", nPaths=3000, nSteps=12, seed=77)
        a = ader.exotic_monte_carlo(req)
        b = ader.exotic_monte_carlo(req)
        self.assertEqual(a.price, b.price)
        self.assertEqual(a.standardError, b.standardError)

    def test_hrp_symmetric_two_asset_case_is_equal_weight(self):
        out = aport.hierarchical_risk_parity(aport.HrpRequest(assets=["A", "B"], covMatrix=[[4, 1], [1, 4]]))
        self.assertAlmostEqual(out.weights["A"], 0.5, places=7)
        self.assertAlmostEqual(out.weights["B"], 0.5, places=7)

    def test_regime_blend_is_probability_weighted(self):
        out = aport.regime_conditioned_blend(aport.RegimeBlendRequest(
            assets=["A", "B"], regimeProbabilities=[0.25, 0.75], regimeWeights=[[1, 0], [0, 1]],
        ))
        self.assertAlmostEqual(out.weights["A"], 0.25, places=8)
        self.assertAlmostEqual(out.weights["B"], 0.75, places=8)

    def test_sotp_known_answer(self):
        out = aval.sum_of_parts(aval.SotpRequest(
            segments=[aval.SegmentValue(name="A", metric=10, multiple=5), aval.SegmentValue(name="B", metric=20, multiple=4)],
            netDebt=30, nonOperatingAssets=10, sharesOutstanding=10,
        ))
        self.assertAlmostEqual(out.enterpriseValue, 130)
        self.assertAlmostEqual(out.equityValue, 110)
        self.assertAlmostEqual(out.valuePerShare, 11)

    def test_probabilistic_dcf_is_seed_reproducible(self):
        req = aval.ProbabilisticDcfRequest(
            currentRevenue=1000, sharesOutstanding=100, years=3, waccPct=10, terminalGrowthPct=2,
            scenarios=[aval.DcfScenario(name="base", revenueGrowthPct=5, ebitMarginPct=20, taxRatePct=25, reinvestmentPctOfRevenue=30, probability=1)],
            nSimulations=1000, growthVolPct=1, marginVolPct=1, seed=9,
        )
        a, b = aval.probabilistic_dcf(req), aval.probabilistic_dcf(req)
        self.assertEqual(a.expectedValuePerShare, b.expectedValuePerShare)
        self.assertLess(a.p05ValuePerShare, a.p95ValuePerShare)

    def test_rating_transition_identity_is_unchanged(self):
        out = acr.rating_migration(acr.MigrationMatrixRequest(
            ratings=["A", "D"], transitionMatrix=[[1, 0], [0, 1]], currentDistribution=[1, 0], periods=5,
        ))
        self.assertAlmostEqual(out.futureDistribution["A"], 1)
        self.assertAlmostEqual(out.cumulativeDefaultProbability, 0)

    def test_stress_pd_monotonically_rises_for_positive_beta_shock(self):
        out = acr.stress_pd(acr.StressPdRequest(basePdPct=[1, 5], macroShock=1, beta=[1, 1]))
        self.assertGreater(out.stressedPdPct[0], 1)
        self.assertGreater(out.stressedPdPct[1], 5)

    def test_synthetic_control_recovers_exact_donor_mix(self):
        out = aecon.synthetic_control(aecon.SyntheticControlRequest(
            treatedPre=[1, 2, 3, 4], donorPre=[[1, 1], [2, 2], [3, 3], [4, 4]],
            treatedPost=[5, 6], donorPost=[[5, 5], [6, 6]],
        ))
        self.assertLess(out.preRmse, 1e-8)
        self.assertAlmostEqual(out.averageTreatmentEffect, 0.0, places=8)

    def test_forecast_tournament_weights_sum_to_one(self):
        series = [float(i + (i % 3) * 0.1) for i in range(60)]
        out = afc.forecast_tournament(afc.ForecastTournamentRequest(series=series, horizon=4, validationWindow=12))
        self.assertAlmostEqual(sum(out.modelWeights.values()), 1.0, places=9)
        self.assertEqual(len(out.ensembleForecast), 4)

    def test_hierarchical_forecasts_reconcile_exactly(self):
        out = afc.reconcile_hierarchy(afc.HierarchicalForecastRequest(
            seriesNames=["total", "A", "B"], baseForecasts={"total": [12, 14], "A": [5, 6], "B": [5, 6]}, hierarchy={"total": ["A", "B"]},
        ))
        self.assertLess(out.maxAggregationError, 1e-12)
        for i in range(2):
            self.assertAlmostEqual(out.reconciledForecasts["total"][i], out.reconciledForecasts["A"][i] + out.reconciledForecasts["B"][i])

    def test_reverse_stress_hits_requested_loss(self):
        out = arisk.reverse_stress(arisk.ReverseStressRequest(assets=["A", "B"], weights=[0.5, 0.5], covMatrixPct2=[[4, 0], [0, 4]], targetPortfolioLossPct=10))
        self.assertAlmostEqual(out.portfolioReturnPct, -10.0, places=7)
        self.assertGreater(out.mahalanobisDistance, 0)

    def test_facility_location_meets_demand(self):
        out = asc.facility_location_milp(asc.FacilityLocationRequest(
            facilities=[asc.Facility(name="F1", fixedCost=10, capacity=20), asc.Facility(name="F2", fixedCost=100, capacity=20)],
            customerNames=["C1"], demand=[10], transportCost=[[1], [10]],
        ))
        self.assertIn("F1", out.openFacilities)
        self.assertAlmostEqual(out.shipment["F1"]["C1"], 10, places=7)

    def test_financed_emissions_attribution(self):
        out = aclim.financed_emissions(aclim.FinancedEmissionsRequest(assets=[
            aclim.FinancedEmissionAsset(name="A", exposure=50, enterpriseValueIncludingCash=100, scope1=10, scope2=10, scope3=20, revenue=100),
        ]))
        self.assertAlmostEqual(out.financedEmissions, 20)
        self.assertAlmostEqual(out.dataCoveragePct, 100)

    def test_inflation_decomposition_known_answer(self):
        out = amacro.inflation_decomposition(amacro.InflationDecompositionRequest(components=[
            amacro.InflationComponent(name="A", weightPct=50, inflationRatePct=4),
            amacro.InflationComponent(name="B", weightPct=50, inflationRatePct=2),
        ]))
        self.assertAlmostEqual(out.headlineInflationPct, 3)

    def test_filing_diff_finds_added_sentence(self):
        out = ares.filing_diff(ares.FilingDiffRequest(oldText="Revenue was 10. Profit rose.", newText="Revenue was 12. Profit rose. New risk emerged."))
        self.assertTrue(any("New risk emerged" in s for s in out.addedSentences))
        self.assertTrue(out.changedNumbers)

    def test_three_statement_model_balances(self):
        out = afm.integrated_three_statement(afm.ThreeStatementRequest(
            forecastYears=2, startingRevenue=100, revenueGrowthPct=[5, 5], ebitdaMarginPct=[20, 20], depreciationPctOfRevenue=[5, 5],
            capexPctOfRevenue=[5, 5], netWorkingCapitalPctOfRevenue=[10, 10], taxRatePct=25, startingCash=20, minimumCash=5,
            startingDebt=10, debtInterestRatePct=5, startingNetPPE=50, startingNWC=10, annualDividends=[0, 0],
        ))
        self.assertLess(out.maxAbsoluteBalanceCheck, 1e-6)

    def test_model_tournament_downweights_extreme_outlier(self):
        out = dsc.model_tournament(dsc.ModelTournamentRequest(candidates=[
            dsc.ModelCandidate(name="A", estimate=100, assuranceScore=90, validationScore=90, dataQualityScore=90),
            dsc.ModelCandidate(name="B", estimate=102, assuranceScore=90, validationScore=90, dataQualityScore=90),
            dsc.ModelCandidate(name="outlier", estimate=1000, assuranceScore=90, validationScore=90, dataQualityScore=90),
        ]))
        self.assertIn("outlier", out.outlierModels)
        self.assertLess(out.weightedEstimate, 110)

    def test_scenario_graph_propagates_in_topological_order(self):
        out = dsc.propagate_scenario(dsc.ScenarioGraphRequest(
            nodes=[dsc.ScenarioNode(name="rates", baseline=5, domain="macro"), dsc.ScenarioNode(name="wacc", baseline=10, domain="valuation"), dsc.ScenarioNode(name="value", baseline=100, domain="valuation")],
            edges=[dsc.ScenarioEdge(source="rates", target="wacc", coefficient=0.5), dsc.ScenarioEdge(source="wacc", target="value", coefficient=-4)],
            shocks=[dsc.ScenarioShock(node="rates", change=2)],
        ))
        self.assertAlmostEqual(out.totalChanges["wacc"], 1)
        self.assertAlmostEqual(out.totalChanges["value"], -4)

    def test_uncertainty_decomposition_matches_independent_variances(self):
        out = dsc.linear_uncertainty(dsc.LinearUncertaintyRequest(centralEstimate=100, factors=[
            dsc.UncertaintyFactor(name="a", standardDeviation=3, sensitivity=1),
            dsc.UncertaintyFactor(name="b", standardDeviation=4, sensitivity=1),
        ]))
        self.assertAlmostEqual(out.standardDeviation, 5.0, places=8)
        self.assertEqual(out.dominantUncertainty, "b")

    def test_value_of_information_is_nonnegative(self):
        out = dsc.value_of_information(dsc.ValueOfInformationRequest(
            stateNames=["good", "bad"], stateProbabilities=[0.5, 0.5], alternatives=[
                dsc.DecisionAlternative(name="invest", payoffs=[20, -10]), dsc.DecisionAlternative(name="wait", payoffs=[5, 5]),
            ],
        ))
        self.assertGreaterEqual(out.valueOfPerfectInformation, 0)
        self.assertIn(out.bestAlternative, {"invest", "wait"})


if __name__ == "__main__":
    unittest.main()
