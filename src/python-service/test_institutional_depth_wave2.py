import math
from pathlib import Path
import re
import unittest

import numpy as np

import advanced_derivatives as ader
import fixed_income_structured as fis
import derivatives_surface as ds
import portfolio_bayesian as pb
import valuation_specialized as vs
from advanced_routes import ROUTES


class StructuredFixedIncomeTests(unittest.TestCase):
    def test_floating_rate_note_is_par_when_quoted_and_discount_margins_match(self):
        out = fis.floating_rate_note(fis.FloatingRateNoteRequest(
            faceValue=100, referenceRatePct=4.0, quotedMarginBps=100, discountMarginBps=100,
            maturityYears=3, frequency=4,
        ))
        self.assertAlmostEqual(out.price, 100.0, places=9)
        self.assertAlmostEqual(out.effectiveDurationYears, 0.0, places=7)
        self.assertAlmostEqual(out.dv01, 0.0, places=7)
        self.assertGreater(out.discountMarginDurationYears, 0)
        self.assertGreater(out.dm01, 0)

    def test_inflation_linked_bond_preserves_current_index_ratio(self):
        out = fis.inflation_linked_bond(fis.InflationLinkedBondRequest(
            faceValue=100, realCouponRatePct=1.5, realYieldPct=1.5, maturityYears=5,
            frequency=2, baseIndex=250, currentIndex=300, expectedInflationPct=2.0,
        ))
        self.assertAlmostEqual(out.realPrice, 100.0, places=9)
        self.assertAlmostEqual(out.currentIndexRatio, 1.2, places=12)
        self.assertAlmostEqual(out.indexedNominalPrice, 120.0, places=9)

    def test_credit_spread_curve_maps_spread_to_hazard(self):
        out = fis.credit_spread_curve(fis.CreditSpreadCurveRequest(
            maturitiesYears=[1, 5], spreadsBps=[120, 120], recoveryRatePct=40,
            queryMaturitiesYears=[2],
        ))
        self.assertAlmostEqual(out.interpolatedSpreadsBps[0], 120.0, places=12)
        self.assertAlmostEqual(out.impliedHazardRatesPct[0], 2.0, places=12)
        self.assertAlmostEqual(out.survivalProbabilitiesPct[0], math.exp(-0.02 * 2) * 100, places=10)

    def test_callable_oas_reprices_supplied_market_value_and_reports_two_risk_conventions(self):
        base = fis.CallableBondOasRequest(
            faceValue=100, couponRatePct=5, maturityYears=5, frequency=2,
            flatRiskFreeRatePct=4, shortRateVolatilityPct=1, marketPrice=100,
            callSchedule=[fis.CallPoint(year=3, callPricePct=100)],
        )
        market = fis._callable_tree_price(base, 0.0125, True)
        req = base.model_copy(update={"marketPrice": market})
        out = fis.callable_bond_oas(req)
        self.assertAlmostEqual(out.optionAdjustedSpreadBps, 125.0, places=6)
        self.assertAlmostEqual(out.modelPriceAtOas, market, places=8)
        self.assertGreaterEqual(out.embeddedCallValue, 0.0)
        self.assertGreater(out.effectiveDurationYears, 0.0)
        self.assertGreater(out.oasSpreadDurationYears, 0.0)
        self.assertTrue(math.isfinite(out.effectiveConvexity))
        self.assertTrue(math.isfinite(out.oasSpreadConvexity))


class DerivativesDepthTests(unittest.TestCase):
    def test_identical_long_short_positions_cancel_all_greeks(self):
        common = dict(name="long", quantity=1, contractMultiplier=100, spot=100, strike=100,
                      maturityYears=1, ratePct=4, dividendYieldPct=1, volatilityPct=20, optionType="call")
        long = ds.OptionPosition(**common)
        short = ds.OptionPosition(**{**common, "name": "short", "quantity": -1})
        out = ds.portfolio_greeks(ds.PortfolioGreeksRequest(positions=[long, short]))
        for value in [out.marketValue, out.delta, out.gamma, out.vegaPerVolPoint, out.thetaPerDay,
                      out.rhoPerRatePoint, out.vanna, out.vomma, out.charmPerDay]:
            self.assertAlmostEqual(value, 0.0, places=10)

    def test_futures_basis_is_zero_mispricing_at_cost_of_carry_fair_value(self):
        spot, days, carry_pct = 100.0, 180, 4.0
        fair = spot * math.exp((carry_pct / 100) * days / 365)
        out = ds.futures_basis(ds.FuturesBasisRequest(
            spotPrice=spot, futuresPrice=fair, daysToMaturity=days,
            financingRatePct=5, incomeYieldPct=1, storageCostPct=0,
        ))
        self.assertAlmostEqual(out.basisMispricing, 0.0, places=10)
        self.assertAlmostEqual(out.impliedNetCarryPct, carry_pct, places=10)

    def test_constant_implied_vol_surface_produces_positive_local_vol(self):
        out = ds.dupire_local_vol(ds.LocalVolRequest(
            spot=100, ratePct=0, dividendYieldPct=0,
            maturitiesYears=[0.25, 0.5, 1.0], strikes=[90, 100, 110],
            impliedVolatilityPct=[[20, 20, 20], [20, 20, 20], [20, 20, 20]],
        ))
        self.assertGreaterEqual(len(out.nodes), 1)
        self.assertTrue(all(node.localVolatilityPct > 0 for node in out.nodes))

    def test_exotic_monte_carlo_is_reproducible_across_chunked_execution(self):
        req = ader.ExoticMonteCarloRequest(
            spot=100, strike=100, maturityYears=1, ratePct=4, dividendYieldPct=1,
            volatilityPct=22, optionType="call", payoffType="asian_arithmetic",
            nPaths=2500, nSteps=1000, seed=12345,
        )
        left = ader.exotic_monte_carlo(req)
        right = ader.exotic_monte_carlo(req)
        self.assertEqual(left.model_dump(), right.model_dump())
        self.assertGreaterEqual(left.standardError, 0.0)
        self.assertTrue(math.isfinite(left.price))


class BayesianPortfolioTests(unittest.TestCase):
    def test_bayesian_mean_lies_between_prior_and_sample(self):
        out = pb.bayesian_mean_shrinkage(pb.BayesianMeanShrinkageRequest(
            assets=["A"], sampleMeanReturnsPct=[12], standardErrorsPct=[4],
            priorMeanReturnsPct=[6], priorStdPct=5,
        ))
        mean = out.posteriorMeanReturnsPct["A"]
        self.assertGreater(mean, 6)
        self.assertLess(mean, 12)
        self.assertGreater(out.dataWeights["A"], 0)
        self.assertLess(out.dataWeights["A"], 1)

    def test_black_litterman_posterior_moves_toward_view(self):
        out = pb.black_litterman(pb.BlackLittermanRequest(
            assets=["A", "B"], marketWeights=[0.5, 0.5], covarianceMatrix=[[4, 1], [1, 3]],
            riskAversion=2, tau=0.05, viewMatrix=[[1, -1]], viewReturnsPct=[5], viewUncertaintyPct2=[0.25],
        ))
        equilibrium_spread = out.equilibriumReturnsPct["A"] - out.equilibriumReturnsPct["B"]
        posterior_spread = out.posteriorReturnsPct["A"] - out.posteriorReturnsPct["B"]
        self.assertLess(abs(5 - posterior_spread), abs(5 - equilibrium_spread))

    def test_ledoit_wolf_output_is_symmetric_psd(self):
        X = [[math.sin(i / 4), math.cos(i / 6), math.sin(i / 9) + 0.2 * math.cos(i / 4)] for i in range(60)]
        out = pb.ledoit_wolf_covariance(pb.RobustCovarianceRequest(assets=["A", "B", "C"], returnsMatrixPct=X))
        cov = np.asarray(out.covarianceMatrixPct2)
        self.assertTrue(np.allclose(cov, cov.T, atol=1e-12))
        self.assertGreaterEqual(float(np.linalg.eigvalsh(cov).min()), -1e-10)
        self.assertGreaterEqual(out.shrinkageIntensity, 0)
        self.assertLessEqual(out.shrinkageIntensity, 1)


class SpecializedValuationTests(unittest.TestCase):
    def test_real_option_contains_nonnegative_time_value(self):
        out = vs.real_option_value(vs.RealOptionRequest(
            underlyingProjectValue=120, exerciseInvestment=100, timeToDecisionYears=2,
            riskFreeRatePct=4, volatilityPct=30, dividendOrDelayCostPct=2, optionType="defer",
        ))
        self.assertGreaterEqual(out.optionValue, out.immediateExerciseValue)
        self.assertGreaterEqual(out.timeValue, 0)

    def test_dcf_surface_increases_with_margin_and_growth(self):
        out = vs.dcf_expectation_surface(vs.DcfExpectationSurfaceRequest(
            currentRevenue=1000, netDebt=100, sharesOutstanding=100, years=5,
            waccPct=10, terminalGrowthPct=3, taxRatePct=25, reinvestmentPctOfRevenue=20,
            revenueGrowthGridPct=[2, 8], ebitMarginGridPct=[15, 25],
        ))
        m = out.valuePerShareMatrix
        self.assertGreater(m[0][1], m[0][0])
        self.assertGreater(m[1][0], m[0][0])
        self.assertGreater(m[1][1], m[0][0])

    def test_project_finance_undefined_ratios_are_json_safe_nulls(self):
        out = vs.project_finance(vs.ProjectFinanceRequest(
            initialEquityInvestment=100, taxRatePct=25, equityDiscountRatePct=10, openingDebt=0,
            years=[vs.ProjectFinanceYear(revenue=80, operatingCost=20, capex=5, debtService=0, depreciation=5)],
        ))
        self.assertIsNone(out.dscrByYear[0])
        self.assertIsNone(out.minimumDscr)
        self.assertIsNone(out.averageDscr)
        self.assertIsNone(out.llcrProxy)
        self.assertNotIn("Infinity", out.model_dump_json())
        self.assertNotIn("NaN", out.model_dump_json())

    def test_saas_zero_cac_is_null_not_infinity(self):
        out = vs.saas_cohort_value(vs.SaaSCohortRequest(
            cohorts=[vs.SaaSCohort(name="organic", startingCustomers=100, monthlyArpu=50,
                                   monthlyLogoChurnPct=2, grossMarginPct=80, acquisitionCostPerCustomer=0)],
            forecastMonths=12, annualDiscountRatePct=10,
        ))
        self.assertIsNone(out.ltvToCacByCohort["organic"])
        self.assertNotIn("Infinity", out.model_dump_json())

    def test_insurance_embedded_value_reconciles(self):
        out = vs.insurance_embedded_value(vs.InsuranceEmbeddedValueRequest(
            adjustedNetAssetValue=500, futureProfitAfterTax=[100, 100], costOfCapitalCharge=[10, 10],
            discountRatePct=10, newBusinessValue=50,
        ))
        self.assertAlmostEqual(out.appraisedValue, out.embeddedValue + 50, places=12)
        self.assertAlmostEqual(out.embeddedValue, 500 + out.presentValueFutureProfits - out.presentValueCostOfCapital, places=12)


class RouterIntegrityTests(unittest.TestCase):
    def test_advanced_router_has_exactly_85_unique_paths(self):
        paths = [path for path, *_ in ROUTES]
        self.assertEqual(len(paths), 85)
        self.assertEqual(len(set(paths)), 85)
        for required in [
            "/fixed-income/callable-oas", "/derivatives/local-volatility", "/portfolio/black-litterman",
            "/valuation/project-finance", "/valuation/dcf-sensitivity", "/decision/scenario-graph",
        ]:
            self.assertIn(required, paths)

    def test_python_router_and_node_allowlist_are_identical(self):
        python_paths = {path.removeprefix("/") for path, *_ in ROUTES}
        # The route registration delegates its allowlist to the execution module;
        # compare against that canonical source so this drift guard follows the
        # production contract instead of a wrapper that intentionally contains no
        # duplicated route literals.
        node_file = Path(__file__).resolve().parent.parent / "server" / "advancedQuantExecution.ts"
        source = node_file.read_text(encoding="utf-8")
        family = r"fixed-income|derivatives|portfolio|valuation|credit|econometrics|forecasting|risk|supply-chain|climate|macro|research|financial-modeling|decision"
        node_paths = set(re.findall(rf'"(({family})/[^"{{}}]+)"', source))
        node_paths = {match[0] for match in node_paths}
        self.assertEqual(node_paths, python_paths)


if __name__ == "__main__":
    unittest.main()
